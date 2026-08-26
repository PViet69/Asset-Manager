"""Unit tests for manual storage scheduler."""

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.file_embeddings.ingestion_service import FileUpload
from backend.app.integrations.qdrant_store import SearchHit
from backend.app.storage.client import DownloadedStorageFile, StorageFile
from backend.app.storage.scheduler import StorageSyncScheduler


@dataclass
class _Client:
    files: list[StorageFile]

    def list_files(self, root: str) -> list[StorageFile]:  # noqa: ARG002
        return self.files

    def download(self, storage_file_id: str) -> DownloadedStorageFile:
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
        "dropbox",
        identifier,
        f"{identifier}.txt",
        "text/plain",
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
    scheduler = StorageSyncScheduler("dropbox", client, "/root", ingestion, qdrant)  # type: ignore[arg-type]
    result = await scheduler.tick_once()
    assert result.provider == "dropbox"
    assert result.upserted == 1
    assert [trace.step for trace in result.traces] == [
        "file_download",
        "file_ingestion",
    ]
    assert all(trace.status == "ok" for trace in result.traces)
    assert ingestion.uploads[0].storage_file_id == "id"
    assert not hasattr(scheduler, "start")
    assert hasattr(scheduler, "stop_sync")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_reindex_deletes_selected_provider_identity_only() -> None:
    scheduler = StorageSyncScheduler(
        "dropbox", _Client([]), "/root", _Ingestion([]), _Qdrant([], [])
    )  # type: ignore[arg-type]
    assert await scheduler.delete_for_reindex("id") == 1


@pytest.mark.unit
@pytest.mark.asyncio
async def test_stop_sync_stops_file_processing() -> None:
    client = _Client([_file("id1"), _file("id2")])
    ingestion = _Ingestion([])
    qdrant = _Qdrant([], [])
    scheduler = StorageSyncScheduler("dropbox", client, "/root", ingestion, qdrant)  # type: ignore[arg-type]
    scheduler.stop_sync()
    result = await scheduler.tick_once()
    assert result.upserted == 0
    assert any(trace.step == "sync_cancel" for trace in result.traces)
