"""Manual provider storage reconciliation."""

import asyncio
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.exceptions import QdrantStorageError
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.storage.client import StorageClient, StorageFile
from backend.app.storage.sync_state import SyncState

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class SyncTickResult:
    provider: str
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    traces: tuple[SyncTraceItem, ...] = ()


class StorageSyncScheduler:
    def __init__(
        self,
        provider: str,
        client: StorageClient,
        root: str,
        ingestion_service: FileIngestionService,
        qdrant_store: QdrantStore,
    ) -> None:
        self._provider = provider
        self._client = client
        self._root = root
        self._ingestion_service = ingestion_service
        self._qdrant_store = qdrant_store
        self._lock = asyncio.Lock()
        self._last_result: SyncTickResult | None = None
        self._cancel_event = threading.Event()

    @property
    def last_result(self) -> SyncTickResult | None:
        return self._last_result

    def stop_sync(self) -> None:
        """Signal current or upcoming sync operation to stop."""
        self._cancel_event.set()

    async def tick_once(
        self, observer: Callable[[SyncTraceItem], None] | None = None
    ) -> SyncTickResult:
        try:
            async with self._lock:
                result = await asyncio.to_thread(
                    self._tick_blocking, observer, self._cancel_event
                )
            self._last_result = result
            return result
        finally:
            self._cancel_event.clear()

    def _tick_blocking(
        self,
        observer: Callable[[SyncTraceItem], None] | None = None,
        cancel_event: Any | None = None,
    ) -> SyncTickResult:
        traces: list[SyncTraceItem] = []

        def trace(
            step: str, status: str, detail: str, file: StorageFile | None = None
        ) -> None:
            item = SyncTraceItem(
                timestamp=datetime.now(timezone.utc).isoformat(),
                provider=self._provider,
                step=step,
                status=status,
                detail=detail,
                filename=file.name if file else None,
                storage_file_id=file.storage_file_id if file else None,
            )
            traces.append(item)
            if observer is not None:
                observer(item)

        try:
            files = self._client.list_files(self._root)
            stored = self._qdrant_store.find_all_with_storage_key(self._provider)
        except QdrantStorageError as exc:
            logger.exception("Storage sync Qdrant read failed")
            trace("qdrant_read", "failed", exc.safe_message)
            return SyncTickResult(self._provider, 0, 0, 0, 1, tuple(traces))
        except Exception:  # noqa: BLE001
            logger.exception("Storage provider traversal failed")
            trace("provider_traversal", "failed", "Provider traversal failed")
            return SyncTickResult(self._provider, 0, 0, 0, 1, tuple(traces))

        plan = SyncState.seed_from_qdrant(files, stored).diff()
        upserted = 0
        for file in plan.to_upsert:
            if cancel_event is not None and cancel_event.is_set():
                trace("sync_cancel", "ok", "Sync operation stopped by user")
                logger.info(
                    "Storage sync stopped by user for provider %s", self._provider
                )
                break
            if self._upsert(file, trace):
                upserted += 1

        failed = len(plan.to_upsert) - upserted
        deleted = 0
        if plan.to_delete_point_ids and (
            cancel_event is None or not cancel_event.is_set()
        ):
            try:
                deleted = self._qdrant_store.delete_by_point_ids(
                    plan.to_delete_point_ids
                )
            except QdrantStorageError as exc:
                logger.exception("Storage sync deletion failed")
                trace("qdrant_delete", "failed", exc.safe_message)
                failed += len(plan.to_delete_point_ids)
        return SyncTickResult(
            self._provider,
            upserted,
            deleted,
            len(plan.unchanged),
            failed,
            tuple(traces),
        )

    def _upsert(
        self,
        file: StorageFile,
        trace: Callable[[str, str, str, StorageFile | None], None],
        max_retries: int = 2,
    ) -> int:
        for attempt in range(max_retries + 1):
            try:
                downloaded = self._client.download(file.storage_file_id)
                trace("file_download", "ok", "Downloaded file", file)
                upload = FileUpload(
                    filename=downloaded.file.name,
                    content_type=downloaded.export_mime_type
                    or downloaded.file.mime_type,
                    content=downloaded.content,
                    file_path=downloaded.file.name,
                    modified_time=downloaded.file.modified_time,
                    provider=self._provider,
                    storage_file_id=downloaded.file.storage_file_id,
                    source_url=downloaded.file.source_url,
                )
                response = self._ingestion_service.process_files((upload,))
                if response.data and response.data[0].status == "success":
                    trace("file_ingestion", "ok", "Indexed file", file)
                    return 1
                if attempt < max_retries:
                    logger.warning(
                        "File ingestion attempt %d failed for %s, retrying...",
                        attempt + 1,
                        file.name,
                    )
                    trace(
                        "file_ingestion",
                        "retry",
                        f"Ingestion attempt {attempt + 1} failed, retrying...",
                        file,
                    )
                    continue
                trace("file_ingestion", "failed", "File ingestion failed", file)
            except Exception as exc:  # noqa: BLE001
                if attempt < max_retries:
                    logger.warning(
                        "Storage file ingestion attempt %d failed for %s (%s), retrying...",
                        attempt + 1,
                        file.name,
                        exc,
                    )
                    trace(
                        "file_ingestion",
                        "retry",
                        f"Attempt {attempt + 1} failed: {exc}",
                        file,
                    )
                    continue
                logger.exception("Storage file ingestion failed for %s", file.name)
                trace("file_ingestion", "failed", "File ingestion failed", file)
        return 0

    async def delete_for_reindex(self, storage_file_id: str) -> int:
        async with self._lock:
            return await asyncio.to_thread(
                self._qdrant_store.delete_by_storage_key,
                self._provider,
                storage_file_id,
            )
