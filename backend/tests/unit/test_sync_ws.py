from datetime import UTC, datetime
from unittest.mock import Mock

import fakeredis
import pytest
from argon2 import PasswordHasher
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig, create_admin_session
from backend.app.api.routes.admin.sync_ws import router as sync_ws_router
from backend.app.tasks.job_store import RedisSyncJobStore, SyncJobProgress


def _auth_config() -> AdminAuthConfig:
    return AdminAuthConfig(
        username="admin",
        password_hash=PasswordHasher().hash("correct-password"),
        session_secret="session-secret-for-tests-only",
        allowed_origin="https://admin.example.test",
    )


def _app_with_store(store: RedisSyncJobStore | None = None) -> FastAPI:
    app = FastAPI()
    app.include_router(sync_ws_router)
    app.state.admin_auth_config = _auth_config()
    app.state.sync_job_store = store
    app.state.sync_events_redis_url = "redis://localhost:6379/1"
    return app


@pytest.mark.unit
def test_sync_ws_rejects_unauthenticated_connection() -> None:
    app = _app_with_store()
    client = TestClient(app)

    with pytest.raises(Exception):
        with client.websocket_connect("/admin/sync-jobs/job-1/ws"):
            pass


@pytest.mark.unit
def test_sync_ws_closes_when_job_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    redis_client = fakeredis.FakeRedis(decode_responses=True)
    store = RedisSyncJobStore(redis_client, 86_400)
    app = _app_with_store(store)

    auth = _auth_config()
    token = create_admin_session(auth, datetime.now(UTC))

    mock_async_redis = Mock()
    mock_pubsub = Mock()
    mock_async_redis.pubsub.return_value = mock_pubsub

    async def _sub(channel: str) -> None:
        pass

    async def _unsub(channel: str) -> None:
        pass

    async def _aclose() -> None:
        pass

    mock_pubsub.subscribe = _sub
    mock_pubsub.unsubscribe = _unsub
    mock_pubsub.aclose = _aclose
    mock_async_redis.aclose = _aclose

    monkeypatch.setattr(
        "backend.app.api.routes.admin.sync_ws.AsyncRedis.from_url",
        lambda *args, **kwargs: mock_async_redis,
    )

    client = TestClient(app, cookies={"admin_session": token})
    with client.websocket_connect("/admin/sync-jobs/nonexistent-job/ws") as ws:
        msg = ws.receive_json()
        assert msg == {"type": "error", "detail": "Job not found"}


@pytest.mark.unit
def test_sync_ws_sends_snapshot_and_closes_terminal_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    redis_client = fakeredis.FakeRedis(decode_responses=True)
    store = RedisSyncJobStore(redis_client, 86_400)
    progress: SyncJobProgress = {
        "provider": "google_drive",
        "state": "SUCCESS",
        "attempt": 1,
        "phase": None,
        "upserted": 1,
        "deleted": 0,
        "unchanged": 0,
        "failed": 0,
        "cancellation_requested": False,
        "detail": None,
        "embedded_delta": 1,
        "activity": (),
    }
    store.write_progress("job-done", progress)

    app = _app_with_store(store)
    auth = _auth_config()
    token = create_admin_session(auth, datetime.now(UTC))

    mock_async_redis = Mock()
    mock_pubsub = Mock()
    mock_async_redis.pubsub.return_value = mock_pubsub

    async def _sub(channel: str) -> None:
        pass

    async def _unsub(channel: str) -> None:
        pass

    async def _aclose() -> None:
        pass

    mock_pubsub.subscribe = _sub
    mock_pubsub.unsubscribe = _unsub
    mock_pubsub.aclose = _aclose
    mock_async_redis.aclose = _aclose

    monkeypatch.setattr(
        "backend.app.api.routes.admin.sync_ws.AsyncRedis.from_url",
        lambda *args, **kwargs: mock_async_redis,
    )

    client = TestClient(app, cookies={"admin_session": token})
    with client.websocket_connect("/admin/sync-jobs/job-done/ws") as ws:
        msg = ws.receive_json()
        assert msg["type"] == "snapshot"
        assert msg["job_id"] == "job-done"
        assert msg["state"] == "SUCCESS"
