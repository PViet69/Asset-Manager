"""Integration tests for provider-scoped admin sync routes."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from unittest.mock import Mock

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig
from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.main import create_app
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import SyncTickResult


@dataclass
class _Client:
    health: str = "ok"
    health_check_count: int = 0

    def list_files(self, root: str) -> list[object]:  # noqa: ARG002
        return [object(), object()]

    def check_health(self) -> str:
        self.health_check_count += 1
        return self.health


@dataclass
class _Qdrant:
    def find_all_with_storage_key(self, provider: str) -> list[object]:  # noqa: ARG002
        return [object()]

    def ensure_collection(self) -> None:
        return None


@dataclass(frozen=True)
class _Model:
    model_name: str

    def check_health(self) -> str:
        return "ok"


@dataclass
class _Scheduler:
    provider: str
    trigger_count: int = 0
    deleted: int = 0
    last_result: SyncTickResult | None = None

    async def tick_once(
        self, observer: Callable[[SyncTraceItem], None] | None = None
    ) -> SyncTickResult:
        self.trigger_count += 1
        trace = SyncTraceItem(
            timestamp="2026-08-26T00:00:00+00:00",
            provider=self.provider,
            step="file_ingestion",
            status="ok",
            detail="Indexed file",
            filename="asset.png",
        )
        if observer is not None:
            observer(trace)
        self.last_result = SyncTickResult(self.provider, 2, 1, 3, 0, (trace,))
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
                    "drive-root" if drive_enabled else None,
                ),
                ProviderSync(
                    "dropbox",
                    "Dropbox",
                    _Client(),
                    dropbox if dropbox_enabled else None,
                    "/dropbox-root" if dropbox_enabled else None,
                ),
            )
        ),
        drive,
        dropbox,
    )


TEST_ORIGIN = "https://admin.example.test"


def _app(registry: ProviderRegistry):
    service = Mock(spec=FileIngestionService)
    service.startup.return_value = None
    return create_app(
        service=service,
        health_dependencies=Mock(
            description_client=_Model("describe-v1"),
            model_client=_Model("embed-v1"),
            qdrant_store=_Qdrant(),
        ),
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
def test_authenticated_dashboard_status_includes_counts_and_model_health() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/sync/status")

    assert response.status_code == 200
    assert response.json()["providers"][0]["detected_count"] == 2
    assert response.json()["providers"][0]["embedded_count"] == 1
    assert response.json()["embedding_model"] == {"name": "embed-v1", "health": "ok"}


@pytest.mark.integration
def test_refresh_requires_allowed_origin_and_refreshes_one_provider() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        rejected = client.post(
            "/admin/sync/dropbox/refresh",
            headers={"Origin": "https://attacker.example.test"},
        )
        accepted = client.post(
            "/admin/sync/dropbox/refresh", headers={"Origin": TEST_ORIGIN}
        )

    assert rejected.status_code == 403
    assert accepted.status_code == 200
    assert accepted.json()["provider"]["provider"] == "dropbox"


@pytest.mark.integration
def test_refresh_requires_session() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        response = client.post(
            "/admin/sync/dropbox/refresh", headers={"Origin": TEST_ORIGIN}
        )

    assert response.status_code == 401


@pytest.mark.integration
def test_stream_requires_session_and_allowed_origin() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        anonymous = client.post(
            "/admin/sync/dropbox/stream", headers={"Origin": TEST_ORIGIN}
        )
        _login(client)
        rejected = client.post(
            "/admin/sync/dropbox/stream",
            headers={"Origin": "https://attacker.example.test"},
        )

    assert anonymous.status_code == 401
    assert rejected.status_code == 403


@pytest.mark.integration
def test_stream_emits_identity_encoded_terminal_event() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        with client.stream(
            "POST", "/admin/sync/dropbox/stream", headers={"Origin": TEST_ORIGIN}
        ) as response:
            body = b"".join(response.iter_bytes())

    events = [
        json.loads(frame.removeprefix("data: "))
        for frame in body.decode().split("\n\n")
        if frame
    ]
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "identity"
    assert events[-1]["terminal"] is True
    assert all(event["provider"] == "dropbox" for event in events)


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
