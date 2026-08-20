"""Unit tests for backend.app.drive.sync_state."""

from datetime import datetime, timezone

import pytest

from backend.app.drive.client import DriveFile
from backend.app.drive.sync_state import SyncPlan, SyncState
from backend.app.integrations.qdrant_store import SearchHit


def _drive(id_: str, modified: datetime) -> DriveFile:
    return DriveFile(
        id=id_,
        name=f"{id_}.txt",
        mime_type="text/plain",
        modified_time=modified,
        size=0,
    )


def _hit(point_id: str, payload: dict) -> SearchHit:
    return SearchHit(point_id=point_id, score=1.0, payload=payload)


@pytest.mark.unit
def test_diff_flags_new_drive_files_as_to_upsert() -> None:
    drive_files = [_drive("a", datetime(2026, 8, 1, tzinfo=timezone.utc))]

    plan = SyncState.seed_from_qdrant(drive_files, []).diff()

    assert [file.id for file in plan.to_upsert] == ["a"]
    assert plan.to_delete_point_ids == []
    assert plan.unchanged == []


@pytest.mark.unit
def test_diff_flags_removed_drive_files_for_deletion() -> None:
    drive_files: list[DriveFile] = []
    stored = [
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

    plan = SyncState.seed_from_qdrant(drive_files, stored).diff()

    assert plan.to_upsert == []
    assert plan.to_delete_point_ids == ["p-1"]


@pytest.mark.unit
def test_diff_marks_unchanged_when_stored_is_newer_or_equal() -> None:
    drive_time = datetime(2026, 8, 1, tzinfo=timezone.utc)
    drive_files = [_drive("a", drive_time)]
    stored = [
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

    plan = SyncState.seed_from_qdrant(drive_files, stored).diff()

    assert plan.to_upsert == []
    assert plan.unchanged[0].id == "a"
    assert plan.is_empty


@pytest.mark.unit
def test_diff_marks_changed_when_drive_file_is_newer() -> None:
    drive_files = [_drive("a", datetime(2026, 8, 10, tzinfo=timezone.utc))]
    stored = [
        _hit(
            "p-1",
            {
                "drive_id": "a",
                "filename": "a.txt",
                "file_type": "text/plain",
                "modified_time": "2026-08-01T00:00:00+00:00",
            },
        )
    ]

    plan = SyncState.seed_from_qdrant(drive_files, stored).diff()

    assert plan.to_upsert[0].id == "a"
    assert plan.unchanged == []


@pytest.mark.unit
def test_diff_ignores_stored_hits_without_drive_id() -> None:
    stored = [_hit("legacy", {"filename": "x.txt"})]

    plan = SyncState.seed_from_qdrant([], stored).diff()

    # legacy hits without drive_id are not in the deletion set either —
    # they were never Drive-originated.
    assert plan.to_delete_point_ids == []


@pytest.mark.unit
def test_record_upserted_adds_to_known_set() -> None:
    state = SyncState.seed_from_qdrant([], [])
    file = _drive("a", datetime(2026, 8, 1, tzinfo=timezone.utc))

    state.record_upserted(file, "p-new")

    plan = state.diff()  # nothing else in drive
    # 'a' is now in drive_by_id; no stored hit, so no plan items
    assert plan.is_empty


@pytest.mark.unit
def test_record_deleted_removes_point_from_known_set() -> None:
    stored = [
        _hit(
            "p-1",
            {
                "drive_id": "a",
                "filename": "a.txt",
                "file_type": "text/plain",
                "modified_time": "2026-08-01T00:00:00+00:00",
            },
        )
    ]
    state = SyncState.seed_from_qdrant([], stored)

    state.record_deleted("p-1")

    plan = state.diff()
    assert plan.to_delete_point_ids == []


@pytest.mark.unit
def test_sync_plan_is_empty_helper() -> None:
    plan = SyncPlan()

    assert plan.is_empty


@pytest.mark.unit
def test_sync_plan_counts() -> None:
    plan = SyncPlan(
        to_upsert=[_drive("a", datetime(2026, 8, 1, tzinfo=timezone.utc))],
        to_delete_point_ids=["p-1"],
        unchanged=[],
    )

    assert plan.upsert_count == 1
    assert plan.delete_count == 1
    assert not plan.is_empty
