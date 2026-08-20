"""Integration tests for admin/sync routes."""

from dataclasses import dataclass

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.drive.scheduler import SyncTickResult
from backend.app.main import create_app


@dataclass
class _StubScheduler:
    last_result: SyncTickResult | None = None
    trigger_count: int = 0
    delete_count: int = 0
    tick_result: SyncTickResult = SyncTickResult(
        upserted=2, deleted=1, unchanged=3, failed=0
    )

    async def start(self) -> None:
        return None

    async def stop(self) -> None:
        return None

    async def tick_once(self) -> SyncTickResult:
        self.trigger_count += 1
        self.last_result = self.tick_result
        return self.tick_result

    async def delete_for_reindex(self, drive_id: str) -> int:
        self.delete_count += 1
        return 1


@pytest.mark.integration
def test_admin_sync_requires_bearer_token(app: FastAPI) -> None:
    stub = _StubScheduler()
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.post("/admin/sync")

    assert response.status_code == 401


@pytest.mark.integration
def test_admin_routes_forbidden_when_no_admin_key_configured(
    app: FastAPI,
) -> None:
    stub = _StubScheduler()
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key=None,
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync",
            headers={"Authorization": "Bearer anything"},
        )

    assert response.status_code == 403


@pytest.mark.integration
def test_admin_sync_returns_503_when_scheduler_disabled(app: FastAPI) -> None:
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=None,
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync",
            headers={"Authorization": "Bearer admin-secret"},
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Drive sync is not configured"}


@pytest.mark.integration
def test_admin_reindex_returns_503_when_scheduler_disabled(
    app: FastAPI,
) -> None:
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=None,
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync/reindex/abc",
            headers={"Authorization": "Bearer admin-secret"},
        )

    assert response.status_code == 503


@pytest.mark.integration
def test_admin_rejects_malformed_authorization_header(app: FastAPI) -> None:
    stub = _StubScheduler()
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync",
            headers={"Authorization": "Basic admin-secret"},
        )

    assert response.status_code == 401


@pytest.mark.integration
def test_admin_sync_runs_tick_when_authorized(app: FastAPI) -> None:
    stub = _StubScheduler()
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync", headers={"Authorization": "Bearer admin-secret"}
        )

    assert response.status_code == 200
    assert response.json() == {
        "upserted": 2,
        "deleted": 1,
        "unchanged": 3,
        "failed": 0,
    }
    assert stub.trigger_count == 1


@pytest.mark.integration
def test_admin_sync_status_reports_disabled_when_no_scheduler(
    app: FastAPI,
) -> None:
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=None,
    )

    with TestClient(app_with) as client:
        response = client.get(
            "/admin/sync/status",
            headers={"Authorization": "Bearer admin-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "enabled": False,
        "last_upserted": None,
        "last_deleted": None,
        "last_unchanged": None,
        "last_failed": None,
    }


@pytest.mark.integration
def test_admin_sync_status_reports_last_result(app: FastAPI) -> None:
    stub = _StubScheduler(
        last_result=SyncTickResult(upserted=4, deleted=0, unchanged=10, failed=0)
    )
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.get(
            "/admin/sync/status",
            headers={"Authorization": "Bearer admin-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {
        "enabled": True,
        "last_upserted": 4,
        "last_deleted": 0,
        "last_unchanged": 10,
        "last_failed": 0,
    }


@pytest.mark.integration
def test_admin_reindex_deletes_by_drive_id(app: FastAPI) -> None:
    stub = _StubScheduler()
    app_with = create_app(
        service=app_with_service_stub(),  # type: ignore[arg-type]
        admin_api_key="admin-secret",
        sync_scheduler=stub,  # type: ignore[arg-type]
    )

    with TestClient(app_with) as client:
        response = client.post(
            "/admin/sync/reindex/abc-123",
            headers={"Authorization": "Bearer admin-secret"},
        )

    assert response.status_code == 200
    assert response.json() == {"drive_id": "abc-123", "deleted": 1}
    assert stub.delete_count == 1


def app_with_service_stub():  # noqa: ANN201
    from unittest.mock import Mock

    from backend.app.file_embeddings.ingestion_service import (
        FileIngestionService,
    )

    service = Mock(spec=FileIngestionService)
    return service
