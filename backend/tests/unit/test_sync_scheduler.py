"""Unit tests for backend.app.drive.scheduler."""

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.config import Settings
from backend.app.drive.client import DownloadedFile, DriveFile
from backend.app.drive.scheduler import (
    SyncScheduler,
    SyncTickResult,
    build_sync_scheduler,
)
from backend.app.file_embeddings.ingestion_service import FileUpload
from backend.app.integrations.qdrant_store import SearchHit


@dataclass
class _FakeDrive:
    files: list[DriveFile]
    bytes: bytes = b"hello"
    download_fails: bool = False

    def traverse_folder(self, folder_id: str) -> list[DriveFile]:  # noqa: ARG002
        return self.files

    def download(self, drive_id: str) -> DownloadedFile:
        if self.download_fails:
            raise RuntimeError("net")
        file = next(f for f in self.files if f.id == drive_id)
        return DownloadedFile(file=file, content=self.bytes)

    def check_health(self) -> str:
        return "ok"


@dataclass
class _FakeIngestion:
    uploads: list[FileUpload]

    def process_files(self, files: tuple[FileUpload, ...]) -> FileEmbeddingResponse:
        self.uploads.extend(files)
        return FileEmbeddingResponse(data=[])


@dataclass
class _FakeQdrant:
    stored: dict[str, list[SearchHit]]
    deleted: list[str]

    def find_all_with_drive_id(self) -> list[SearchHit]:
        out: list[SearchHit] = []
        for hits in self.stored.values():
            out.extend(hits)
        return out

    def find_by_drive_id(self, drive_id: str) -> list[SearchHit]:
        return list(self.stored.get(drive_id, []))

    def delete_by_drive_id(self, drive_id: str) -> int:
        hits = self.stored.pop(drive_id, [])
        self.deleted.extend(hit.point_id for hit in hits)
        return len(hits)

    def delete_by_point_ids(self, point_ids: list[str]) -> int:
        self.deleted.extend(point_ids)
        return len(point_ids)


def _file(id_: str, modified: datetime) -> DriveFile:
    return DriveFile(
        id=id_,
        name=f"{id_}.txt",
        mime_type="text/plain",
        modified_time=modified,
        size=0,
    )


def _hit(point_id: str, payload: dict) -> SearchHit:
    return SearchHit(point_id=point_id, score=1.0, payload=payload)


def _scheduler(
    drive: _FakeDrive, ingestion: _FakeIngestion, qdrant: _FakeQdrant
) -> SyncScheduler:
    return SyncScheduler(
        drive_client=drive,  # type: ignore[arg-type]
        ingestion_service=ingestion,  # type: ignore[arg-type]
        qdrant_store=qdrant,  # type: ignore[arg-type]
        folder_id="folder",
        interval_seconds=3600,
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tick_once_upserts_new_files() -> None:
    drive = _FakeDrive(files=[_file("a", datetime(2026, 8, 1, tzinfo=timezone.utc))])
    ingestion = _FakeIngestion(uploads=[])
    qdrant = _FakeQdrant(stored={}, deleted=[])
    scheduler = _scheduler(drive, ingestion, qdrant)

    result = await scheduler.tick_once()

    assert result.upserted == 1
    assert result.deleted == 0
    assert result.failed == 0
    assert len(ingestion.uploads) == 1
    assert ingestion.uploads[0].drive_id == "a"
    assert scheduler.last_result == result


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tick_once_deletes_removed_files() -> None:
    drive = _FakeDrive(files=[])
    ingestion = _FakeIngestion(uploads=[])
    qdrant = _FakeQdrant(
        stored={
            "gone": [
                _hit(
                    "p-1",
                    {
                        "drive_id": "gone",
                        "filename": "gone.txt",
                        "file_type": "text/plain",
                        "modified_time": "2026-08-01T00:00:00+00:00",
                    },
                )
            ]
        },
        deleted=[],
    )
    scheduler = _scheduler(drive, ingestion, qdrant)

    result = await scheduler.tick_once()

    assert result.upserted == 0
    assert result.deleted == 1
    assert qdrant.deleted == ["p-1"]


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tick_once_marks_unchanged_when_modified_time_equal() -> None:
    drive_time = datetime(2026, 8, 1, tzinfo=timezone.utc)
    drive = _FakeDrive(files=[_file("a", drive_time)])
    ingestion = _FakeIngestion(uploads=[])
    qdrant = _FakeQdrant(
        stored={
            "a": [
                _hit(
                    "p-1",
                    {
                        "drive_id": "a",
                        "filename": "a.txt",
                        "file_type": "text/plain",
                        "modified_time": drive_time.isoformat(),
                    },
                )
            ]
        },
        deleted=[],
    )
    scheduler = _scheduler(drive, ingestion, qdrant)

    result = await scheduler.tick_once()

    assert result.upserted == 0
    assert result.unchanged == 1
    assert result.deleted == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_tick_once_counts_upsert_failure() -> None:
    drive = _FakeDrive(
        files=[_file("a", datetime(2026, 8, 1, tzinfo=timezone.utc))],
        download_fails=True,
    )
    ingestion = _FakeIngestion(uploads=[])
    qdrant = _FakeQdrant(stored={}, deleted=[])
    scheduler = _scheduler(drive, ingestion, qdrant)

    result = await scheduler.tick_once()

    assert result.failed == 1
    assert result.upserted == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_delete_for_reindex_passes_through_to_qdrant() -> None:
    drive = _FakeDrive(files=[])
    ingestion = _FakeIngestion(uploads=[])
    qdrant = _FakeQdrant(
        stored={
            "x": [
                _hit(
                    "p-x",
                    {
                        "drive_id": "x",
                        "filename": "x.txt",
                        "file_type": "text/plain",
                        "modified_time": "2026-08-01T00:00:00+00:00",
                    },
                )
            ]
        },
        deleted=[],
    )
    scheduler = _scheduler(drive, ingestion, qdrant)

    deleted = await scheduler.delete_for_reindex("x")

    assert deleted == 1
    assert qdrant.deleted == ["p-x"]


@pytest.mark.unit
def test_build_sync_scheduler_returns_none_when_drive_not_configured() -> None:
    settings = Settings(
        MODEL_ENDPOINT_URL="https://model.example",
        DESCRIPTION_MODEL="vision-model",
        DESCRIPTION_ENDPOINT_URL="https://vision.example",
        DESCRIPTION_ENDPOINT_API_KEY="vision-key",
        EMBEDDING_MODEL="embedding-model",
        QDRANT_URL="https://qdrant.example",
        QDRANT_VECTOR_SIZE=2,
        _env_file=None,
    )

    scheduler = build_sync_scheduler(
        settings=settings,
        drive_client=None,  # type: ignore[arg-type]
        ingestion_service=None,  # type: ignore[arg-type]
        qdrant_store=None,  # type: ignore[arg-type]
    )

    assert scheduler is None


@pytest.mark.unit
def test_sync_tick_result_is_immutable() -> None:
    result = SyncTickResult(upserted=0, deleted=0, unchanged=0, failed=0)

    with pytest.raises((AttributeError, TypeError)):
        result.upserted = 5  # type: ignore[misc]
