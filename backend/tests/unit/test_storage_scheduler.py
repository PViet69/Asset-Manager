"""Unit tests for manual storage scheduler."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from unittest.mock import patch

import pytest

from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.file_embeddings.ingestion_service import FileUpload
from backend.app.integrations.qdrant_store import SearchHit
from backend.app.storage import StorageProvider
from backend.app.storage.client import (
    DownloadedStorageFile,
    StorageFile,
)
from backend.app.storage.scheduler import StorageSyncScheduler


@dataclass
class _Client:
    files: list[StorageFile]
    download_calls: list[str] = field(default_factory=list)

    def list_files(self, root: str) -> list[StorageFile]:  # noqa: ARG002
        return self.files

    def download(self, storage_file_id: str) -> DownloadedStorageFile:
        self.download_calls.append(storage_file_id)
        return DownloadedStorageFile(
            next(
                file for file in self.files if file.storage_file_id == storage_file_id
            ),
            b"hello",
        )

    def check_health(self) -> str:
        return "ok"


@dataclass
class _Ingestion:
    uploads: list[FileUpload]

    def process_files(self, files: tuple[FileUpload, ...]) -> FileEmbeddingResponse:
        self.uploads.extend(files)
        from backend.app.api.schemas.file_embeddings import FileEmbeddingItem

        return FileEmbeddingResponse(
            data=[
                FileEmbeddingItem(
                    filename=files[0].filename,
                    content_type=files[0].content_type,
                    status="success",
                    reason=None,
                )
            ]
        )


@dataclass
class _Qdrant:
    hits: list[SearchHit]
    deleted: list[str]

    def find_all_with_storage_key(self, provider: str) -> list[SearchHit]:  # noqa: ARG002
        return self.hits

    def delete_by_point_ids(self, point_ids: list[str]) -> int:
        self.deleted.extend(point_ids)
        return len(point_ids)

    def delete_by_storage_key(self, provider: str, storage_file_id: str) -> int:  # noqa: ARG002
        self.deleted.append(storage_file_id)
        return 1


def _file(identifier: str) -> StorageFile:
    return StorageFile(
        StorageProvider.DROPBOX,
        identifier,
        f"{identifier}.png",
        "image/png",
        datetime(2026, 8, 1, tzinfo=timezone.utc),
        0,
        f"https://dropbox.example.test/{identifier}",
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tick_once_manually_ingests_new_provider_file() -> None:
    client = _Client([_file("id")])
    ingestion = _Ingestion([])
    qdrant = _Qdrant([], [])
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", ingestion, qdrant
    )  # type: ignore[arg-type]
    result = await scheduler.tick_once()
    assert result.provider == StorageProvider.DROPBOX
    assert result.upserted == 1
    assert [trace.step for trace in result.traces] == [
        "file_prepare",
        "file_indexing",
        "file_ingestion",
    ]
    assert all(trace.status == "ok" for trace in result.traces)
    assert ingestion.uploads[0].storage_file_id == "id"
    assert not hasattr(scheduler, "start")
    assert hasattr(scheduler, "stop_sync")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_sync_rejects_oversized_video_before_provider_download() -> None:
    video = StorageFile(
        StorageProvider.DROPBOX,
        "video-id",
        "clip.mp4",
        "video/mp4",
        datetime(2026, 8, 1, tzinfo=timezone.utc),
        200 * 1024 * 1024 + 1,
        "https://dropbox.example.test/video-id",
    )
    client = _Client([video])
    ingestion = _Ingestion([])
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", ingestion, _Qdrant([], [])
    )  # type: ignore[arg-type]

    result = await scheduler.tick_once()

    assert result.upserted == 0
    assert client.download_calls == []
    assert ingestion.uploads == []
    assert any(trace.detail == "Video exceeds 200 MiB limit" for trace in result.traces)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reindex_deletes_selected_provider_identity_only() -> None:
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, _Client([]), "/root", _Ingestion([]), _Qdrant([], [])
    )  # type: ignore[arg-type]
    assert await scheduler.delete_for_reindex("id") == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stop_sync_before_preparing_is_ignored() -> None:
    client = _Client([_file("id1"), _file("id2")])
    ingestion = _Ingestion([])
    qdrant = _Qdrant([], [])
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", ingestion, qdrant
    )  # type: ignore[arg-type]

    assert scheduler.stop_sync() is False

    result = await scheduler.tick_once()

    assert result.upserted == 2
    assert not any(trace.step == "sync_cancel" for trace in result.traces)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stop_sync_during_preparing_skips_file_indexing() -> None:
    client = _Client([_file("id")])
    ingestion = _Ingestion([])
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", ingestion, _Qdrant([], [])
    )  # type: ignore[arg-type]
    original_download = client.download

    def stop_during_preparing(storage_file_id: str) -> DownloadedStorageFile:
        scheduler.stop_sync()
        return original_download(storage_file_id)

    client.download = stop_during_preparing

    result = await scheduler.tick_once()

    assert result.upserted == 0
    assert ingestion.uploads == []
    assert [trace.step for trace in result.traces] == [
        "file_prepare",
        "sync_cancel",
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_waits_one_second_between_preparing_and_indexing() -> None:
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX,
        _Client([_file("id")]),
        "/root",
        _Ingestion([]),
        _Qdrant([], []),
    )  # type: ignore[arg-type]

    with patch("backend.app.storage.scheduler.time.sleep") as sleep:
        await scheduler.tick_once()

    sleep.assert_called_once_with(1)


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stop_sync_during_indexing_finishes_current_file() -> None:
    client = _Client([_file("id1"), _file("id2")])
    ingestion = _Ingestion([])
    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", ingestion, _Qdrant([], [])
    )  # type: ignore[arg-type]

    def stop_during_indexing(trace: object) -> None:
        if getattr(trace, "step", None) == "file_indexing":
            assert scheduler.stop_sync() is True

    result = await scheduler.tick_once(stop_during_indexing)

    assert result.upserted == 1
    assert [upload.storage_file_id for upload in ingestion.uploads] == ["id1"]
    assert [trace.step for trace in result.traces] == [
        "file_prepare",
        "file_indexing",
        "file_ingestion",
    ]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_ingestion_failure_retries_and_allows_subsequent_sync_retry() -> None:
    client = _Client([_file("id1")])
    call_count = 0

    class _FailingIngestion:
        def process_files(self, files: tuple[FileUpload, ...]) -> FileEmbeddingResponse:
            nonlocal call_count
            call_count += 1
            from backend.app.api.schemas.file_embeddings import FileEmbeddingItem

            if call_count < 2:
                raise RuntimeError("Transient ingestion failure")
            return FileEmbeddingResponse(
                data=[
                    FileEmbeddingItem(
                        filename=files[0].filename,
                        content_type=files[0].content_type,
                        status="success",
                        reason=None,
                    )
                ]
            )

    scheduler = StorageSyncScheduler(
        StorageProvider.DROPBOX, client, "/root", _FailingIngestion(), _Qdrant([], [])
    )  # type: ignore[arg-type]

    result = await scheduler.tick_once()
    assert result.provider == StorageProvider.DROPBOX
    assert call_count == 2
    assert any(trace.status == "retry" for trace in result.traces)
