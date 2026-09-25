"""Manual provider storage reconciliation."""

import asyncio
import logging
import threading
import time
from collections.abc import Callable
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
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
        concurrency: int = 1,
    ) -> None:
        self._provider = provider
        self._client = client
        self._root = root
        self._ingestion_service = ingestion_service
        self._qdrant_store = qdrant_store
        self._concurrency = max(1, concurrency)
        self._lock = asyncio.Lock()
        self._last_result: SyncTickResult | None = None
        self._cancel_event = threading.Event()
        self._is_processing_file = threading.Event()
        self._active_files_lock = threading.Lock()
        self._active_files_count = 0

    @property
    def last_result(self) -> SyncTickResult | None:
        return self._last_result

    def stop_sync(self) -> bool:
        """Stop sync after the current provider file finishes."""
        if not self._is_processing_file.is_set():
            return False
        self._cancel_event.set()
        return True

    async def tick_once(
        self,
        observer: Callable[[SyncTraceItem], None] | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> SyncTickResult:
        try:
            async with self._lock:
                result = await asyncio.to_thread(
                    self._tick_blocking,
                    observer,
                    self._cancel_event,
                    should_cancel,
                )
            self._last_result = result
            return result
        finally:
            self._cancel_event.clear()
            self._is_processing_file.clear()

    def _tick_blocking(
        self,
        observer: Callable[[SyncTraceItem], None] | None = None,
        cancel_event: Any | None = None,
        should_cancel: Callable[[], bool] | None = None,
    ) -> SyncTickResult:
        traces: list[SyncTraceItem] = []
        trace_lock = threading.Lock()

        def trace(
            step: str,
            status: str,
            detail: str,
            file: StorageFile | None = None,
            embedded_delta: int = 0,
        ) -> None:
            item = SyncTraceItem(
                timestamp=datetime.now(timezone.utc).isoformat(),
                provider=self._provider,
                step=step,
                status=status,
                detail=detail,
                filename=file.name if file else None,
                storage_file_id=file.storage_file_id if file else None,
                embedded_delta=embedded_delta,
            )
            with trace_lock:
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
        existing_storage_file_ids = {
            storage_file_id
            for hit in stored
            if isinstance((storage_file_id := hit.payload.get("storage_file_id")), str)
            and storage_file_id
        }

        upserted = 0
        cancelled = False

        def is_cancelled() -> bool:
            nonlocal cancelled
            if cancelled:
                return True
            try:
                if (cancel_event is not None and cancel_event.is_set()) or (
                    should_cancel is not None and should_cancel()
                ):
                    cancelled = True
                    return True
            except StopIteration:
                return cancelled
            return False

        if self._concurrency <= 1:
            for file in plan.to_upsert:
                if is_cancelled():
                    trace("sync_cancel", "ok", "Sync operation stopped by user")
                    break
                is_new = file.storage_file_id not in existing_storage_file_ids
                if self._upsert(
                    file,
                    trace,
                    cancel_event,
                    embedded_delta=int(is_new),
                ):
                    upserted += 1
                if is_cancelled():
                    logger.info(
                        "Storage sync stopped by user for provider %s", self._provider
                    )
                    break
        else:
            def process_file(file: StorageFile) -> int:
                if is_cancelled():
                    return 0
                is_new = file.storage_file_id not in existing_storage_file_ids
                return self._upsert(
                    file,
                    trace,
                    cancel_event,
                    embedded_delta=int(is_new),
                )

            with ThreadPoolExecutor(max_workers=self._concurrency) as executor:
                futures = {}
                file_iter = iter(plan.to_upsert)

                for _ in range(self._concurrency):
                    if is_cancelled():
                        break
                    try:
                        next_file = next(file_iter)
                        futures[executor.submit(process_file, next_file)] = next_file
                    except StopIteration:
                        break

                while futures:
                    done_set, _ = wait(futures.keys(), return_when=FIRST_COMPLETED)
                    for fut in done_set:
                        del futures[fut]
                        try:
                            if fut.result():
                                upserted += 1
                        except Exception:
                            logger.exception(
                                "Error processing storage file in thread pool"
                            )

                        if not is_cancelled():
                            try:
                                next_file = next(file_iter)
                                future = executor.submit(process_file, next_file)
                                futures[future] = next_file
                            except StopIteration:
                                pass

                if cancelled:
                    logger.info(
                        "Storage sync stopped by user for provider %s", self._provider
                    )

        failed = len(plan.to_upsert) - upserted
        deleted = 0
        if plan.to_delete_point_ids and not cancelled and not is_cancelled():
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
        trace: Callable[[str, str, str, StorageFile | None, int], None],
        cancel_event: Any | None = None,
        max_retries: int = 2,
        embedded_delta: int = 0,
    ) -> int:
        with self._active_files_lock:
            self._active_files_count += 1
            self._is_processing_file.set()

        trace("file_prepare", "ok", "Preparing file", file)
        try:
            downloaded = self._client.download(file.storage_file_id)
            time.sleep(1)
            if cancel_event is not None and cancel_event.is_set():
                trace("sync_cancel", "ok", "Sync operation stopped by user", file)
                return 0

            upload = FileUpload(
                filename=downloaded.file.name,
                content_type=downloaded.export_mime_type or downloaded.file.mime_type,
                content=downloaded.content,
                file_path=downloaded.file.name,
                modified_time=downloaded.file.modified_time,
                provider=self._provider,
                storage_file_id=downloaded.file.storage_file_id,
                source_url=downloaded.file.source_url,
            )
            for attempt in range(max_retries + 1):
                try:
                    trace("file_indexing", "ok", "Sending file to model", file)
                    response = self._ingestion_service.process_files((upload,))
                    if response.data and response.data[0].status == "success":
                        trace(
                            "file_ingestion",
                            "ok",
                            "Indexed file",
                            file,
                            embedded_delta,
                        )
                        return 1
                    if attempt < max_retries:
                        logger.warning(
                            "File ingestion attempt %d failed for %s, retrying...",
                            attempt + 1,
                            file.name,
                        )
                        trace(
                            "file_indexing",
                            "retry",
                            f"Ingestion attempt {attempt + 1} failed, retrying...",
                            file,
                        )
                        continue
                    trace("file_ingestion", "failed", "File ingestion failed", file)
                except Exception as exc:  # noqa: BLE001
                    if attempt < max_retries:
                        logger.warning(
                            "Storage file ingestion attempt %d failed for %s (%s), "
                            "retrying...",
                            attempt + 1,
                            file.name,
                            exc,
                        )
                        trace(
                            "file_indexing",
                            "retry",
                            f"Attempt {attempt + 1} failed: {exc}",
                            file,
                        )
                        continue
                    logger.exception("Storage file ingestion failed for %s", file.name)
                    trace("file_ingestion", "failed", "File ingestion failed", file)
            return 0
        finally:
            with self._active_files_lock:
                self._active_files_count -= 1
                if self._active_files_count == 0:
                    self._is_processing_file.clear()

    async def delete_for_reindex(self, storage_file_id: str) -> int:
        async with self._lock:
            return await asyncio.to_thread(
                self._qdrant_store.delete_by_storage_key,
                self._provider,
                storage_file_id,
            )
