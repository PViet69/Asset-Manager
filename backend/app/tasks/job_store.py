"""Redis repository for provider sync job coordination."""

import json
from typing import Literal, Protocol, TypedDict

from redis import Redis

from backend.app.config import Settings

MAX_SYNC_JOB_ACTIVITY_EVENTS = 50

SyncJobActivityStatus = Literal[
    "preparing", "indexing", "indexed", "failed", "stopped"
]


class SyncJobActivity(TypedDict):
    """Safe per-ingestion activity visible to administrators."""

    sequence: int
    storage_file_id: str
    filename: str
    status: SyncJobActivityStatus
    embedded_delta: int


class SyncJobProgress(TypedDict):
    """Safe, JSON-serializable worker progress."""

    provider: str
    state: str
    attempt: int
    phase: str | None
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    cancellation_requested: bool
    detail: str | None
    embedded_delta: int
    activity: tuple[SyncJobActivity, ...]


class SyncJobStore(Protocol):
    """Storage operations shared by API and Celery workers."""

    def acquire_provider_job(self, provider: str, job_id: str) -> str | None: ...

    def get_provider_job_id(self, provider: str) -> str | None: ...

    def release_provider_job(self, provider: str, job_id: str) -> None: ...

    def request_cancellation(self, provider: str, job_id: str) -> None: ...

    def is_cancellation_requested(self, provider: str, job_id: str) -> bool: ...

    def write_progress(self, job_id: str, progress: SyncJobProgress) -> None: ...

    def append_activity(self, job_id: str, activity: SyncJobActivity) -> None: ...

    def read_progress(self, job_id: str) -> SyncJobProgress | None: ...


class RedisSyncJobStore:
    """Redis-backed provider lock, cancellation, and safe-progress repository."""

    def __init__(self, redis_client: Redis, ttl_seconds: int) -> None:
        self._redis_client = redis_client
        self._ttl_seconds = ttl_seconds

    @classmethod
    def from_settings(cls, settings: Settings) -> "RedisSyncJobStore":
        """Create Redis job store from validated queue settings."""
        return cls(
            Redis.from_url(settings.CELERY_RESULT_BACKEND, decode_responses=True),
            settings.CELERY_RESULT_EXPIRES_SECONDS,
        )

    def acquire_provider_job(self, provider: str, job_id: str) -> str | None:
        key = self._provider_key(provider)
        acquired = self._redis_client.set(key, job_id, nx=True, ex=self._ttl_seconds)
        if acquired:
            return None
        return self._decode(self._redis_client.get(key))

    def get_provider_job_id(self, provider: str) -> str | None:
        return self._decode(self._redis_client.get(self._provider_key(provider)))

    def release_provider_job(self, provider: str, job_id: str) -> None:
        key = self._provider_key(provider)
        with self._redis_client.pipeline() as pipeline:
            while True:
                try:
                    pipeline.watch(key)
                    if self._decode(pipeline.get(key)) != job_id:
                        pipeline.unwatch()
                        return
                    pipeline.multi()
                    pipeline.delete(key)
                    pipeline.execute()
                    return
                except Exception:  # noqa: BLE001
                    pipeline.reset()
                    return

    def request_cancellation(self, provider: str, job_id: str) -> None:
        self._redis_client.set(
            self._cancel_key(job_id),
            provider,
            ex=self._ttl_seconds,
        )

    def is_cancellation_requested(self, provider: str, job_id: str) -> bool:
        return (
            self._decode(self._redis_client.get(self._cancel_key(job_id))) == provider
        )

    def write_progress(self, job_id: str, progress: SyncJobProgress) -> None:
        self._redis_client.set(
            self._progress_key(job_id),
            json.dumps(progress),
            ex=self._ttl_seconds,
        )
        self._redis_client.expire(
            self._provider_key(progress["provider"]), self._ttl_seconds
        )

    def publish_event(self, job_id: str, event: dict) -> None:
        """Publish a sync job event to the Redis Pub/Sub channel."""
        self._redis_client.publish(
            self.events_channel(job_id),
            json.dumps(event),
        )

    def append_activity(self, job_id: str, activity: SyncJobActivity) -> None:
        validated_activity = self._validated_activity(activity)
        if validated_activity is None:
            raise ValueError("Invalid sync job activity")
        progress = self.read_progress(job_id)
        if progress is None:
            return
        existing = progress["activity"]
        existing_card = next(
            (
                item
                for item in existing
                if item["storage_file_id"] == validated_activity["storage_file_id"]
            ),
            None,
        )
        activity_history = tuple(
            validated_activity
            if item["storage_file_id"] == validated_activity["storage_file_id"]
            else item
            for item in existing
        )
        if existing_card is None:
            activity_history = (
                *activity_history,
                validated_activity,
            )[-MAX_SYNC_JOB_ACTIVITY_EVENTS:]
        updated: SyncJobProgress = {
            **progress,
            "embedded_delta": progress.get("embedded_delta", 0)
            + int(
                validated_activity["status"] == "indexed"
                and validated_activity.get("embedded_delta", 0) == 1
                and (existing_card is None or existing_card["status"] != "indexed")
            ),
            "activity": tuple(
                sorted(activity_history, key=lambda item: item["sequence"])
            ),
        }
        self.write_progress(job_id, updated)

    def read_progress(self, job_id: str) -> SyncJobProgress | None:
        raw_progress = self._decode(self._redis_client.get(self._progress_key(job_id)))
        if raw_progress is None:
            return None
        decoded = json.loads(raw_progress)
        if not isinstance(decoded, dict):
            return None
        activity = self._validated_activity_history(decoded.get("activity", []))
        return {
            "provider": decoded["provider"],
            "state": decoded["state"],
            "attempt": decoded["attempt"],
            "phase": decoded["phase"],
            "upserted": decoded["upserted"],
            "deleted": decoded["deleted"],
            "unchanged": decoded["unchanged"],
            "failed": decoded["failed"],
            "cancellation_requested": decoded["cancellation_requested"],
            "detail": decoded["detail"],
            "embedded_delta": int(decoded.get("embedded_delta", 0)),
            "activity": activity,
        }

    @staticmethod
    def _validated_activity_history(value: object) -> tuple[SyncJobActivity, ...]:
        if not isinstance(value, list):
            return ()
        activities = tuple(
            item
            for value_item in value[-MAX_SYNC_JOB_ACTIVITY_EVENTS:]
            if (item := RedisSyncJobStore._validated_activity(value_item)) is not None
        )
        if len(activities) != len(value):
            return ()
        if any(
            current["sequence"] >= following["sequence"]
            for current, following in zip(activities, activities[1:], strict=False)
        ):
            return ()
        return activities

    @staticmethod
    def _validated_activity(value: object) -> SyncJobActivity | None:
        if not isinstance(value, dict):
            return None
        keys = set(value.keys())
        if not (
            {"sequence", "storage_file_id", "filename", "status"}
            <= keys
            <= {"sequence", "storage_file_id", "filename", "status", "embedded_delta"}
        ):
            return None
        sequence = value.get("sequence")
        storage_file_id = value.get("storage_file_id")
        filename = value.get("filename")
        event_status = value.get("status")
        embedded_delta = value.get("embedded_delta", 0)
        valid_statuses: set[str] = {
            "preparing",
            "indexing",
            "indexed",
            "failed",
            "stopped",
        }
        if (
            not isinstance(sequence, int)
            or isinstance(sequence, bool)
            or sequence < 1
            or not isinstance(storage_file_id, str)
            or not storage_file_id
            or len(storage_file_id) > 255
            or not isinstance(filename, str)
            or not filename
            or len(filename) > 255
            or event_status not in valid_statuses
            or not isinstance(embedded_delta, int)
            or isinstance(embedded_delta, bool)
            or embedded_delta not in (0, 1)
        ):
            return None
        return {
            "sequence": sequence,
            "storage_file_id": storage_file_id,
            "filename": filename,
            "status": event_status,
            "embedded_delta": embedded_delta,
        }

    @staticmethod
    def _decode(value: str | bytes | None) -> str | None:
        if isinstance(value, bytes):
            return value.decode()
        return value

    @staticmethod
    def _provider_key(provider: str) -> str:
        return f"sync-job:provider:{provider}:active"

    @staticmethod
    def _progress_key(job_id: str) -> str:
        return f"sync-job:{job_id}:progress"

    @staticmethod
    def _cancel_key(job_id: str) -> str:
        return f"sync-job:{job_id}:cancel"

    @staticmethod
    def events_channel(job_id: str) -> str:
        """Redis Pub/Sub channel for real-time sync job events."""
        return f"sync-job:{job_id}:events"
