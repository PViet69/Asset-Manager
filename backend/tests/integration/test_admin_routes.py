"""Integration tests for provider-scoped admin sync routes."""

from dataclasses import dataclass
from unittest.mock import Mock

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.main import create_app
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import SyncTickResult


@dataclass
class _Client:
    health: str = "ok"
    health_check_count: int = 0

    def check_health(self) -> str:
        self.health_check_count += 1
        return self.health


@dataclass
class _Scheduler:
    provider: str
    trigger_count: int = 0
    deleted: int = 0
    last_result: SyncTickResult | None = None

    async def tick_once(self) -> SyncTickResult:
        self.trigger_count += 1
        self.last_result = SyncTickResult(self.provider, 2, 1, 3, 0)
        return self.last_result

    async def delete_for_reindex(self, storage_file_id: str) -> int:  # noqa: ARG002
        self.deleted += 1
        return 1


def _registry(
    drive_enabled: bool = True, dropbox_enabled: bool = True
) -> tuple[ProviderRegistry, _Scheduler, _Scheduler]:
    drive = _Scheduler("google_drive")
    dropbox = _Scheduler("dropbox")
    return (
        ProviderRegistry(
            (
                ProviderSync(
                    "google_drive",
                    "Google Drive",
                    _Client(),
                    drive if drive_enabled else None,
                ),
                ProviderSync(
                    "dropbox",
                    "Dropbox",
                    _Client(),
                    dropbox if dropbox_enabled else None,
                ),
            )
        ),
        drive,
        dropbox,
    )


TEST_ORIGIN = "https://admin.example.test"


def _app(registry: ProviderRegistry):
    service = Mock(spec=FileIngestionService)
    return create_app(
        service=service,
        admin_auth_config=AdminAuthConfig(
            username="admin",
            password_hash=PasswordHasher().hash("correct-password"),
            session_secret="session-secret-for-tests-only",
            allowed_origin=TEST_ORIGIN,
        ),
        provider_registry=registry,
    )


def _login(client: TestClient) -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "correct-password"},
        headers={"Origin": TEST_ORIGIN},
    )
    assert response.status_code == 200


@pytest.mark.integration
def test_admin_sync_requires_session() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 401


@pytest.mark.integration
def test_admin_sync_rejects_cross_origin_session_request() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post(
            "/admin/sync/dropbox", headers={"Origin": "https://attacker.example.test"}
        )
    assert response.status_code == 403


@pytest.mark.integration
def test_unknown_provider_returns_404() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post("/admin/sync/unknown", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 404


@pytest.mark.integration
def test_disabled_selected_provider_returns_503() -> None:
    registry, _, _ = _registry(dropbox_enabled=False)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 503


@pytest.mark.integration
def test_selected_provider_runs_without_triggering_other_provider() -> None:
    registry, drive, dropbox = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 200
    assert response.json()["provider"] == "dropbox"
    assert dropbox.trigger_count == 1
    assert drive.trigger_count == 0


@pytest.mark.integration
def test_status_returns_all_registered_providers() -> None:
    registry, _, _ = _registry(dropbox_enabled=False)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/sync/status")
    assert response.status_code == 200
    assert [item["provider"] for item in response.json()["providers"]] == [
        "google_drive",
        "dropbox",
    ]
    assert response.json()["providers"][1]["enabled"] is False


@pytest.mark.integration
def test_status_caches_provider_health_checks() -> None:
    registry, _, _ = _registry()
    clients = tuple(entry.client for entry in registry.providers)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        first_response = client.get("/admin/sync/status")
        second_response = client.get("/admin/sync/status")
    assert first_response.status_code == 200
    assert second_response.status_code == 200
    assert all(client.health_check_count == 1 for client in clients)


@pytest.mark.integration
def test_sync_refreshes_cached_provider_health() -> None:
    registry, _, _ = _registry()
    clients = tuple(entry.client for entry in registry.providers)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        client.get("/admin/sync/status")
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 200
    assert clients[0].health_check_count == 1
    assert clients[1].health_check_count == 2


@pytest.mark.integration
def test_reindex_is_scoped_to_requested_provider() -> None:
    registry, drive, dropbox = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post(
            "/admin/sync/dropbox/reindex/id-1", headers={"Origin": TEST_ORIGIN}
        )
    assert response.status_code == 200
    assert response.json() == {
        "provider": "dropbox",
        "storage_file_id": "id-1",
        "deleted": 1,
    }
    assert dropbox.deleted == 1
    assert drive.deleted == 0
