"""Celery task that executes provider sync in a worker process."""

import asyncio
import logging
import threading
from collections.abc import Callable
from typing import Protocol

from celery import Task
from redis import Redis

from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.config import Settings
from backend.app.exceptions import (
    ModelEndpointError,
    ModelNotFoundError,
    QdrantStorageError,
)
from backend.app.services.runtime import RuntimeDependencies, build_runtime_dependencies
from backend.app.tasks.celery_app import celery_app
from backend.app.tasks.job_store import (
    RedisSyncJobStore,
    SyncJobActivity,
    SyncJobProgress,
)
from backend.app.tasks.sync_activity import activity_from_trace

logger = logging.getLogger(__name__)


class SyncTaskDispatcher(Protocol):
    """Celery dispatch interface used by API routes."""

    def dispatch(self, provider: str, task_id: str) -> None: ...

    def revoke(self, task_id: str) -> None: ...


class CelerySyncTaskDispatcher:
    """Production dispatcher around Celery task invocation."""

    def dispatch(self, provider: str, task_id: str) -> None:
        sync_provider.apply_async(args=(provider,), task_id=task_id)

    def revoke(self, task_id: str) -> None:
        celery_app.control.revoke(task_id, terminate=False)


def build_job_store(settings: Settings) -> RedisSyncJobStore:
    """Create worker-local Redis job store."""
    return RedisSyncJobStore(
        Redis.from_url(settings.CELERY_RESULT_BACKEND, decode_responses=True),
        settings.CELERY_RESULT_EXPIRES_SECONDS,
    )


def is_transient_sync_error(error: Exception) -> bool:
    """Return whether error is a retryable temporary service failure."""
    if isinstance(error, ModelNotFoundError):
        return False
    if not isinstance(error, (ModelEndpointError, QdrantStorageError)):
        return False
    message = str(error).lower()
    return any(
        marker in message
        for marker in ("timeout", "temporar", "unavailable", "connection", "rate limit")
    )


def _progress(
    provider: str,
    state: str,
    attempt: int,
    *,
    phase: str | None = None,
    upserted: int = 0,
    deleted: int = 0,
    unchanged: int = 0,
    failed: int = 0,
    cancellation_requested: bool = False,
    detail: str | None = None,
    embedded_delta: int = 0,
    activity: tuple[SyncJobActivity, ...] = (),
) -> SyncJobProgress:
    return {
        "provider": provider,
        "state": state,
        "attempt": attempt,
        "phase": phase,
        "upserted": upserted,
        "deleted": deleted,
        "unchanged": unchanged,
        "failed": failed,
        "cancellation_requested": cancellation_requested,
        "detail": detail,
        "embedded_delta": embedded_delta,
        "activity": activity,
    }


def run_provider_sync(
    dependencies: RuntimeDependencies,
    provider: str,
    should_cancel: Callable[[], bool],
    observer: Callable[[SyncTraceItem], None],
) -> SyncJobProgress:
    """Run one provider scheduler from worker-local dependencies."""
    entry = dependencies.provider_registry.get(provider)
    if entry is None or entry.scheduler is None:
        raise ValueError("Provider sync is not configured")
    result = asyncio.run(
        entry.scheduler.tick_once(observer=observer, should_cancel=should_cancel)
    )
    entry.health_cache.refresh()
    return _progress(
        provider,
        "SUCCESS",
        0,
        upserted=result.upserted,
        deleted=result.deleted,
        unchanged=result.unchanged,
        failed=result.failed,
    )


@celery_app.task(bind=True, name="backend.app.tasks.sync_tasks.sync_provider")
def sync_provider(self: Task, provider: str) -> SyncJobProgress:
    """Run provider sync with safe status, retry, and cancellation behavior."""
    settings = Settings()
    store = build_job_store(settings)
    job_id = self.request.id or "local-sync-task"
    attempt = self.request.retries + 1

    if store.is_cancellation_requested(provider, job_id):
        revoked = _progress(
            provider,
            "REVOKED",
            attempt,
            cancellation_requested=True,
        )
        store.write_progress(job_id, revoked)
        store.release_provider_job(provider, job_id)
        return revoked

    previous_progress = store.read_progress(job_id)
    previous_activity = (
        previous_progress["activity"]
        if isinstance(previous_progress, dict) and "activity" in previous_progress
        else ()
    )
    previous_embedded_delta = (
        previous_progress["embedded_delta"]
        if isinstance(previous_progress, dict) and "embedded_delta" in previous_progress
        else 0
    )

    store.write_progress(
        job_id,
        _progress(
            provider,
            "STARTED",
            attempt,
            embedded_delta=previous_embedded_delta,
            activity=previous_activity,
        ),
    )
    next_sequence = previous_activity[-1]["sequence"] + 1 if previous_activity else 1
    observe_lock = threading.Lock()

    def observe(trace: SyncTraceItem) -> None:
        nonlocal next_sequence
        with observe_lock:
            activity = activity_from_trace(trace, next_sequence)
            if activity is None:
                return
            next_sequence += 1
            try:
                store.append_activity(job_id, activity)
            except Exception:  # noqa: BLE001
                logger.exception(
                    "Could not persist sync activity", extra={"job_id": job_id}
                )

    try:
        dependencies = build_runtime_dependencies(settings)
        result = run_provider_sync(
            dependencies,
            provider,
            lambda: store.is_cancellation_requested(provider, job_id),
            observe,
        )
        cancelled = store.is_cancellation_requested(provider, job_id)
        latest_progress = store.read_progress(job_id)
        if isinstance(latest_progress, dict):
            activity = latest_progress.get("activity", ())
            current_embedded_delta = latest_progress.get(
                "embedded_delta", previous_embedded_delta
            )
        else:
            activity = ()
            current_embedded_delta = previous_embedded_delta
        terminal = (
            _progress(
                provider,
                "REVOKED",
                attempt,
                cancellation_requested=True,
                embedded_delta=current_embedded_delta,
                activity=activity,
            )
            if cancelled
            else _progress(
                provider,
                "SUCCESS",
                attempt,
                upserted=result["upserted"],
                deleted=result["deleted"],
                unchanged=result["unchanged"],
                failed=result["failed"],
                embedded_delta=current_embedded_delta,
                activity=activity,
            )
        )
        store.write_progress(job_id, terminal)
        return terminal
    except Exception as error:  # noqa: BLE001
        latest_progress = store.read_progress(job_id)
        if isinstance(latest_progress, dict):
            activity = latest_progress.get("activity", ())
            current_embedded_delta = latest_progress.get(
                "embedded_delta", previous_embedded_delta
            )
        else:
            activity = ()
            current_embedded_delta = previous_embedded_delta
        if is_transient_sync_error(error) and self.request.retries < 2:
            retry = _progress(
                provider,
                "RETRY",
                attempt,
                detail="Provider sync retrying",
                embedded_delta=current_embedded_delta,
                activity=activity,
            )
            store.write_progress(job_id, retry)
            raise self.retry(
                exc=error,
                countdown=2**self.request.retries,
                max_retries=2,
            ) from error
        logger.exception(
            "Provider sync failed",
            extra={"job_id": job_id, "provider": provider, "attempt": attempt},
        )
        failure = _progress(
            provider,
            "FAILURE",
            attempt,
            failed=1,
            detail="Provider sync failed",
            embedded_delta=current_embedded_delta,
            activity=activity,
        )
        store.write_progress(job_id, failure)
        return failure
    finally:
        progress = store.read_progress(job_id)
        if progress is not None and progress["state"] in {
            "SUCCESS",
            "FAILURE",
            "REVOKED",
        }:
            store.release_provider_job(provider, job_id)
