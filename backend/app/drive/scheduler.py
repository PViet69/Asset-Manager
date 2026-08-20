"""Background scheduler that keeps Drive and Qdrant in sync."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import timedelta

from backend.app.config import Settings
from backend.app.drive.client import DriveClient, DriveFile, is_configured
from backend.app.drive.sync_state import SyncPlan, SyncState
from backend.app.exceptions import (
    FileProcessingError,
    ModelEndpointError,
    QdrantStorageError,
)
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.integrations.qdrant_store import QdrantStore

logger = logging.getLogger(__name__)

MAX_BACKOFF_SECONDS = 60.0


@dataclass(frozen=True)
class SyncTickResult:
    """Summary of a single sync tick."""

    upserted: int
    deleted: int
    unchanged: int
    failed: int


class SyncScheduler:
    """Periodically reconcile Drive snapshots with Qdrant state."""

    def __init__(
        self,
        drive_client: DriveClient,
        ingestion_service: FileIngestionService,
        qdrant_store: QdrantStore,
        folder_id: str,
        interval_seconds: int,
    ) -> None:
        self._drive_client = drive_client
        self._ingestion_service = ingestion_service
        self._qdrant_store = qdrant_store
        self._folder_id = folder_id
        self._interval = timedelta(seconds=interval_seconds)
        self._task: asyncio.Task[None] | None = None
        self._lock = asyncio.Lock()
        self._stop_event = asyncio.Event()
        self._last_result: SyncTickResult | None = None

    @property
    def last_result(self) -> SyncTickResult | None:
        """Result of the most recent tick (read by admin status endpoint)."""
        return self._last_result

    async def start(self) -> None:
        """Begin the periodic sync loop. Idempotent."""
        if self._task is not None and not self._task.done():
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_forever(), name="drive-sync")

    async def stop(self) -> None:
        """Stop the periodic sync loop and wait for it to finish."""
        if self._task is None:
            return
        self._stop_event.set()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        finally:
            self._task = None

    async def tick_once(self) -> SyncTickResult:
        """Run one full sync tick. Concurrent callers wait on the lock."""
        async with self._lock:
            result = await asyncio.to_thread(self._tick_blocking)
        self._last_result = result
        return result

    def _tick_blocking(self) -> SyncTickResult:
        """Synchronous core of one tick (run via to_thread)."""
        try:
            drive_files = self._drive_client.traverse_folder(self._folder_id)
        except Exception:  # noqa: BLE001
            logger.exception("Drive traverse failed")
            return SyncTickResult(0, 0, 0, 0)
        try:
            stored = self._qdrant_store.find_all_with_drive_id()
        except QdrantStorageError:
            logger.exception("Qdrant read failed")
            return SyncTickResult(0, 0, 0, 0)
        plan = SyncState.seed_from_qdrant(drive_files, stored).diff()
        return self._apply_plan(plan, drive_files)

    def _apply_plan(
        self, plan: SyncPlan, drive_files: list[DriveFile]
    ) -> SyncTickResult:
        by_id = {file.id: file for file in drive_files}
        upserted = 0
        failed = 0
        for drive_file in plan.to_upsert:
            if self._upsert_one(drive_file):
                upserted += 1
            else:
                failed += 1
        deleted = 0
        if plan.to_delete_point_ids:
            try:
                self._qdrant_store.delete_by_point_ids(plan.to_delete_point_ids)
                deleted = len(plan.to_delete_point_ids)
            except QdrantStorageError:
                logger.exception("Qdrant delete failed")
                failed += len(plan.to_delete_point_ids)
        _ = by_id  # kept for future per-file metadata logging
        return SyncTickResult(
            upserted=upserted,
            deleted=deleted,
            unchanged=len(plan.unchanged),
            failed=failed,
        )

    def _upsert_one(self, drive_file: DriveFile) -> bool:
        """Download + ingest one Drive file. Return True on success."""
        try:
            downloaded = self._drive_client.download(drive_file.id)
        except Exception:  # noqa: BLE001
            logger.exception("Drive download failed for %s", drive_file.id)
            return False
        effective_mime = downloaded.export_mime_type or downloaded.file.mime_type
        upload = FileUpload(
            filename=downloaded.file.name,
            content_type=effective_mime,
            content=downloaded.content,
            file_path=downloaded.file.name,
            drive_id=downloaded.file.id,
            modified_time=downloaded.file.modified_time,
        )
        try:
            self._ingestion_service.process_files((upload,))
        except (
            FileProcessingError,
            ModelEndpointError,
            QdrantStorageError,
        ):
            logger.exception("Ingestion failed for %s", drive_file.id)
            return False
        return True

    async def delete_for_reindex(self, drive_id: str) -> int:
        """Delete all stored points for a single Drive file id."""
        async with self._lock:
            return await asyncio.to_thread(
                self._qdrant_store.delete_by_drive_id, drive_id
            )

    async def _run_forever(self) -> None:
        """Periodic loop with exponential backoff on transient failures."""
        backoff = 1.0
        while not self._stop_event.is_set():
            try:
                await self.tick_once()
                backoff = 1.0
            except Exception:  # noqa: BLE001
                logger.exception("Sync tick crashed; backing off")
                backoff = min(backoff * 2, MAX_BACKOFF_SECONDS)
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self._interval.total_seconds(),
                )
            except asyncio.TimeoutError:
                continue


def build_sync_scheduler(
    settings: Settings,
    drive_client: DriveClient,
    ingestion_service: FileIngestionService,
    qdrant_store: QdrantStore,
) -> SyncScheduler | None:
    """Construct a scheduler when Drive is configured, else None."""
    if not is_configured(settings):
        return None
    return SyncScheduler(
        drive_client=drive_client,
        ingestion_service=ingestion_service,
        qdrant_store=qdrant_store,
        folder_id=settings.DRIVE_FOLDER_ID,  # type: ignore[arg-type]
        interval_seconds=settings.DRIVE_SYNC_INTERVAL_SECONDS,
    )
