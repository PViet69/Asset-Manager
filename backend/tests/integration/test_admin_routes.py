"""Integration tests for provider-scoped admin sync routes."""

from collections.abc import Callable
from dataclasses import dataclass
from unittest.mock import Mock

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig
from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.qdrant_store import SearchHit
from backend.app.main import create_app
from backend.app.storage import StorageProvider
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import SyncTickResult
from backend.app.tag_settings.store import TagIndexResult, TagSettingsStore


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
    def find_all_with_storage_key(self, provider: str) -> list[SearchHit]:  # noqa: ARG002
        return [
            SearchHit(
                point_id="point-1",
                score=1.0,
                payload={
                    "filename": "photo.png",
                    "file_path": "photo.png",
                    "storage_file_id": "file-1",
                    "file_type": "image/png",
                },
            )
        ]

    def ensure_collection(self) -> None:
        return None

    def delete_by_point_ids(self, point_ids: list[str]) -> int:
        return len(point_ids)


@dataclass(frozen=True)
class _Model:
    model_name: str
    health: str = "ok"

    def check_health(self) -> str:
        return self.health


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
    drive = _Scheduler(StorageProvider.GOOGLE_DRIVE)
    dropbox = _Scheduler(StorageProvider.DROPBOX)
    return (
        ProviderRegistry(
            (
                ProviderSync(
                    StorageProvider.GOOGLE_DRIVE,
                    "Google Drive",
                    _Client(),
                    drive if drive_enabled else None,
                    "drive-root" if drive_enabled else None,
                ),
                ProviderSync(
                    StorageProvider.DROPBOX,
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


def _app(registry: ProviderRegistry, embedding_model_health: str = "ok"):
    service = Mock(spec=FileIngestionService)
    service.startup.return_value = None
    sync_job_store = Mock()
    sync_job_store.acquire_provider_job.return_value = None
    sync_task_dispatcher = Mock()
    return create_app(
        service=service,
        health_dependencies=Mock(
            description_client=_Model("describe-v1"),
            model_client=_Model("embed-v1", embedding_model_health),
            qdrant_store=_Qdrant(),
        ),
        admin_auth_config=AdminAuthConfig(
            username="admin",
            password_hash=PasswordHasher().hash("correct-password"),
            session_secret="session-secret-for-tests-only",
            allowed_origin=TEST_ORIGIN,
        ),
        provider_registry=registry,
        sync_job_store=sync_job_store,
        sync_task_dispatcher=sync_task_dispatcher,
    )


def _login(client: TestClient) -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "correct-password"},
        headers={"Origin": TEST_ORIGIN},
    )
    assert response.status_code == 200


@pytest.mark.integration
def test_admin_tag_discovery_indexes_and_returns_grouped_tags() -> None:
    registry, _, _ = _registry()
    tag_settings_store = Mock(spec=TagSettingsStore)
    tag_settings_store.discover_and_index.return_value = TagIndexResult(
        indexed_assets=2,
        tags=("color:black", "subject:laptop"),
    )
    app = _app(registry)
    app.state.tag_settings_store = tag_settings_store

    with TestClient(app, base_url="https://testserver") as client:
        _login(client)
        response = client.post("/admin/tags/discover", headers={"Origin": TEST_ORIGIN})

    assert response.status_code == 200
    assert response.json() == {
        "indexed_assets": 2,
        "groups": [
            {"category": "Colors", "tags": ["color:black"]},
            {"category": "Subjects", "tags": ["subject:laptop"]},
        ],
    }
    tag_settings_store.discover_and_index.assert_called_once_with()


@pytest.mark.integration
def test_admin_tags_returns_grouped_approved_tags() -> None:
    registry, _, _ = _registry()
    tag_settings_store = Mock(spec=TagSettingsStore)
    tag_settings_store.get_approved_tags.return_value = (
        "color:black",
        "subject:laptop",
    )
    app = _app(registry)
    app.state.tag_settings_store = tag_settings_store

    with TestClient(app, base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/tags")

    assert response.status_code == 200
    assert response.json() == {
        "groups": [
            {"category": "Colors", "tags": ["color:black"]},
            {"category": "Subjects", "tags": ["subject:laptop"]},
        ]
    }


@pytest.mark.integration
def test_admin_tags_saves_selected_discovered_tags() -> None:
    registry, _, _ = _registry()
    tag_settings_store = Mock(spec=TagSettingsStore)
    tag_settings_store.replace_approved_tags.return_value = (
        "color:black",
        "subject:laptop",
    )
    app = _app(registry)
    app.state.tag_settings_store = tag_settings_store

    with TestClient(app, base_url="https://testserver") as client:
        _login(client)
        response = client.put(
            "/admin/tags",
            json={
                "discovered_tags": ["color:black", "subject:laptop"],
                "approved_tags": ["subject:laptop", "color:black"],
            },
            headers={"Origin": TEST_ORIGIN},
        )

    assert response.status_code == 200
    assert response.json() == {
        "groups": [
            {"category": "Colors", "tags": ["color:black"]},
            {"category": "Subjects", "tags": ["subject:laptop"]},
        ]
    }
    tag_settings_store.replace_approved_tags.assert_called_once_with(
        ["subject:laptop", "color:black"]
    )


@pytest.mark.integration
def test_admin_tags_rejects_selected_tags_outside_discovery() -> None:
    registry, _, _ = _registry()
    tag_settings_store = Mock(spec=TagSettingsStore)
    app = _app(registry)
    app.state.tag_settings_store = tag_settings_store

    with TestClient(app, base_url="https://testserver") as client:
        _login(client)
        response = client.put(
            "/admin/tags",
            json={
                "discovered_tags": ["subject:laptop"],
                "approved_tags": ["color:black"],
            },
            headers={"Origin": TEST_ORIGIN},
        )

    assert response.status_code == 422
    assert response.json() == {"detail": "Approved tags must come from discovered tags"}
    tag_settings_store.replace_approved_tags.assert_not_called()


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
def test_selected_provider_is_queued_without_running_api_scheduler() -> None:
    registry, drive, dropbox = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 202
    assert response.json()["provider"] == StorageProvider.DROPBOX
    assert response.json()["state"] == "PENDING"
    client.app.state.sync_job_store.write_progress.assert_called_once_with(
        response.json()["job_id"],
        {
            "provider": "dropbox",
            "state": "PENDING",
            "attempt": 0,
            "phase": None,
            "upserted": 0,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "cancellation_requested": False,
            "detail": None,
            "activity": (),
        },
    )
    assert dropbox.trigger_count == 0
    assert drive.trigger_count == 0


@pytest.mark.integration
def test_status_returns_all_registered_providers() -> None:
    registry, _, _ = _registry(dropbox_enabled=False)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/sync/status")
    assert response.status_code == 200
    assert [item["provider"] for item in response.json()["providers"]] == [
        StorageProvider.GOOGLE_DRIVE,
        StorageProvider.DROPBOX,
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
    assert accepted.json()["provider"]["provider"] == StorageProvider.DROPBOX


@pytest.mark.integration
def test_refresh_requires_session() -> None:
    registry, _, _ = _registry()

    with TestClient(_app(registry), base_url="https://testserver") as client:
        response = client.post(
            "/admin/sync/dropbox/refresh", headers={"Origin": TEST_ORIGIN}
        )

    assert response.status_code == 401


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
def test_sync_enqueue_does_not_refresh_provider_health_in_api_process() -> None:
    registry, _, _ = _registry()
    clients = tuple(entry.client for entry in registry.providers)
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        client.get("/admin/sync/status")
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    assert response.status_code == 202
    assert clients[0].health_check_count == 1
    assert clients[1].health_check_count == 1


@pytest.mark.integration
def test_start_duplicate_provider_sync_returns_conflict_with_active_job() -> None:
    registry, _, _ = _registry()
    app = _app(registry)

    with TestClient(app, base_url="https://testserver") as client:
        client.app.state.sync_job_store.acquire_provider_job.return_value = "job-active"
        _login(client)
        response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Dropbox sync already running",
        "job_id": "job-active",
    }


@pytest.mark.integration
def test_job_status_returns_only_safe_progress() -> None:
    registry, _, _ = _registry()
    app = _app(registry)

    with TestClient(app, base_url="https://testserver") as client:
        client.app.state.sync_job_store.read_progress.return_value = {
            "provider": "dropbox",
            "state": "STARTED",
            "attempt": 1,
            "phase": "indexing",
            "upserted": 1,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "cancellation_requested": False,
            "detail": None,
            "embedded_delta": 2,
            "activity": (
                {
                    "sequence": 1,
                    "storage_file_id": "file-1",
                    "filename": "asset.png",
                    "status": "indexing",
                },
            ),
        }
        _login(client)
        response = client.get("/admin/sync-jobs/job-1")

    assert response.status_code == 200
    assert response.json()["state"] == "STARTED"
    assert response.json()["embedded_delta"] == 2
    assert response.json()["activity"] == [
        {
            "sequence": 1,
            "storage_file_id": "file-1",
            "filename": "asset.png",
            "status": "indexing",
        }
    ]
    assert "traceback" not in response.text
    assert "internal detail" not in response.text
    assert "source_url" not in response.text


@pytest.mark.integration
def test_stop_revokes_pending_provider_job_and_releases_lock() -> None:
    registry, _, _ = _registry()
    app = _app(registry)

    with TestClient(app, base_url="https://testserver") as client:
        client.app.state.sync_job_store.get_provider_job_id.return_value = "job-1"
        client.app.state.sync_job_store.read_progress.return_value = {
            "provider": "dropbox",
            "state": "PENDING",
            "attempt": 0,
            "phase": None,
            "upserted": 0,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "cancellation_requested": False,
            "detail": None,
            "activity": (),
        }
        _login(client)
        response = client.post(
            "/admin/sync/dropbox/stop", headers={"Origin": TEST_ORIGIN}
        )

    assert response.status_code == 200
    client.app.state.sync_task_dispatcher.revoke.assert_called_once_with("job-1")
    client.app.state.sync_job_store.request_cancellation.assert_called_once_with(
        "dropbox", "job-1"
    )
    client.app.state.sync_job_store.write_progress.assert_called_once_with(
        "job-1",
        {
            "provider": "dropbox",
            "state": "REVOKED",
            "attempt": 0,
            "phase": None,
            "upserted": 0,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "cancellation_requested": True,
            "detail": None,
            "activity": (),
        },
    )
    client.app.state.sync_job_store.release_provider_job.assert_called_once_with(
        "dropbox", "job-1"
    )


@pytest.mark.integration
def test_stop_requests_cancellation_for_running_provider_job() -> None:
    registry, _, _ = _registry()
    app = _app(registry)

    with TestClient(app, base_url="https://testserver") as client:
        client.app.state.sync_job_store.get_provider_job_id.return_value = "job-1"
        client.app.state.sync_job_store.read_progress.return_value = {
            "provider": "dropbox",
            "state": "STARTED",
            "attempt": 1,
            "phase": "indexing",
            "upserted": 0,
            "deleted": 0,
            "unchanged": 0,
            "failed": 0,
            "cancellation_requested": False,
            "detail": None,
            "activity": (),
        }
        _login(client)
        response = client.post(
            "/admin/sync/dropbox/stop", headers={"Origin": TEST_ORIGIN}
        )
        client.app.state.sync_job_store.request_cancellation.assert_called_once_with(
            "dropbox", "job-1"
        )

    assert response.status_code == 200
    assert response.json() == {"provider": "dropbox", "status": "stopping"}


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
        "provider": StorageProvider.DROPBOX,
        "storage_file_id": "id-1",
        "deleted": 1,
    }
    assert dropbox.deleted == 1
    assert drive.deleted == 0


@pytest.mark.integration
def test_delete_qdrant_point_removes_point() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.post(
            "/admin/sync/qdrant/delete/point-123", headers={"Origin": TEST_ORIGIN}
        )
    assert response.status_code == 200
    assert response.json() == {
        "point_id": "point-123",
        "deleted": 1,
    }


@pytest.mark.integration
def test_list_provider_items_returns_items() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/sync/dropbox/items")
    assert response.status_code == 200
    assert response.json() == {
        "provider": StorageProvider.DROPBOX,
        "items": [
            {
                "point_id": "point-1",
                "filename": "photo.png",
                "file_path": "photo.png",
                "storage_file_id": "file-1",
                "file_type": "image/png",
                "thumbnail_url": "/v1/storage/dropbox/file-1/thumbnail",
                "modified_time": None,
            }
        ],
    }
