"""WebSocket endpoint for real-time sync job activity notifications."""

import asyncio
import json
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis.asyncio import Redis as AsyncRedis

from backend.app.admin_auth import AdminAuthConfig, get_session_username
from backend.app.tasks.job_store import RedisSyncJobStore

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])


async def _listen_redis(
    pubsub,  # noqa: ANN001
    websocket: WebSocket,
    max_snapshot_seq: int,
) -> None:
    """Forward Redis Pub/Sub messages to the WebSocket client."""
    async for message in pubsub.listen():
        if message["type"] != "message":
            continue
        data = json.loads(message["data"])
        if data.get("type") == "activity":
            activity = data.get("activity", {})
            if activity.get("sequence", 0) <= max_snapshot_seq:
                continue
        await websocket.send_json(data)
        if data.get("type") == "terminal":
            return


async def _listen_client(websocket: WebSocket) -> None:
    """Wait for the client to disconnect."""
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        return


@router.websocket("/admin/sync-jobs/{job_id}/ws")
async def sync_job_ws(websocket: WebSocket, job_id: str) -> None:
    """Stream real-time sync activity events over WebSocket."""
    config: AdminAuthConfig = websocket.app.state.admin_auth_config
    token = websocket.cookies.get("admin_session")
    username = (
        get_session_username(config, token, datetime.now(UTC)) if token else None
    )
    if username is None:
        await websocket.close(code=4401, reason="Authentication required")
        return

    await websocket.accept()

    store = getattr(websocket.app.state, "sync_job_store", None)
    redis_url = getattr(websocket.app.state, "sync_events_redis_url", None)
    if not redis_url or not store:
        await websocket.send_json(
            {"type": "error", "detail": "Sync service unavailable"}
        )
        await websocket.close(code=1011)
        return

    async_redis = AsyncRedis.from_url(redis_url, decode_responses=True)
    pubsub = async_redis.pubsub()
    channel = RedisSyncJobStore.events_channel(job_id)

    try:
        # Subscribe FIRST to avoid missing events between snapshot read
        # and subscription start.
        await pubsub.subscribe(channel)

        progress = await asyncio.to_thread(store.read_progress, job_id)
        if progress is None:
            await websocket.send_json(
                {"type": "error", "detail": "Job not found"}
            )
            await websocket.close(code=4404)
            return

        await websocket.send_json(
            {"type": "snapshot", "job_id": job_id, **progress}
        )

        if progress["state"] in {"SUCCESS", "FAILURE", "REVOKED"}:
            await websocket.close(code=1000)
            return

        max_snapshot_seq = max(
            (a["sequence"] for a in progress.get("activity", ())),
            default=0,
        )

        redis_task = asyncio.create_task(
            _listen_redis(pubsub, websocket, max_snapshot_seq)
        )
        client_task = asyncio.create_task(_listen_client(websocket))

        done, pending = await asyncio.wait(
            {redis_task, client_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

        for task in done:
            if task.exception() is not None:
                logger.warning(
                    "Sync WS task error for job %s: %s",
                    job_id,
                    task.exception(),
                )
    except WebSocketDisconnect:
        pass
    except Exception:  # noqa: BLE001
        logger.exception("Sync WebSocket error for job %s", job_id)
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.aclose()
        await async_redis.aclose()
        try:
            await websocket.close(code=1000)
        except Exception:  # noqa: BLE001
            pass
