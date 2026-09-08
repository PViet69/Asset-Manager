"""Unit tests for provider-scoped sync reconciliation."""

from datetime import datetime, timezone

import pytest

from backend.app.integrations.qdrant_store import SearchHit
from backend.app.storage import StorageProvider
from backend.app.storage.client import StorageFile
from backend.app.storage.sync_state import SyncState


def _file(identifier: str, modified: datetime) -> StorageFile:
    return StorageFile(
        StorageProvider.DROPBOX,
        identifier,
        f"{identifier}.txt",
        "text/plain",
        modified,
        0,
    )





@pytest.mark.unit
def test_diff_scopes_new_changed_and_removed_records_to_provider_snapshot() -> None:
    now = datetime(2026, 8, 2, tzinfo=timezone.utc)
    old = datetime(2026, 8, 1, tzinfo=timezone.utc)
    hits = [
        SearchHit(
            "old-point",
            1.0,
            {"storage_file_id": "old", "modified_time": old.isoformat()},
        ),
        SearchHit(
            "gone-point",
            1.0,
            {"storage_file_id": "gone", "modified_time": old.isoformat()},
        ),
    ]
    plan = SyncState.seed_from_qdrant(
        [_file("old", now), _file("new", now)], hits
    ).diff()
    assert [file.storage_file_id for file in plan.to_upsert] == ["old", "new"]
    assert plan.to_delete_point_ids == ["gone-point"]


@pytest.mark.unit
def test_diff_ignores_legacy_hit_without_generic_storage_identity() -> None:
    plan = SyncState.seed_from_qdrant(
        [], [SearchHit("legacy", 1.0, {"drive_id": "old"})]
    ).diff()
    assert plan.to_delete_point_ids == []
