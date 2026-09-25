from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.tasks.sync_activity import activity_from_trace


def _trace(step: str, status: str, detail: str = "internal detail") -> SyncTraceItem:
    return SyncTraceItem(
        timestamp="2026-09-25T00:00:00+00:00",
        provider="dropbox",
        step=step,
        status=status,
        detail=detail,
        filename="secret.pdf",
        storage_file_id="secret-id",
    )


def test_activity_from_trace_maps_safe_ingestion_event() -> None:
    activity = activity_from_trace(_trace("file_ingestion", "ok"), 4)

    assert activity == {
        "sequence": 4,
        "storage_file_id": "secret-id",
        "filename": "secret.pdf",
        "status": "indexed",
        "embedded_delta": 0,
    }
    assert "internal detail" not in str(activity)


def test_activity_from_trace_maps_indexing_retry_to_indexing_card() -> None:
    activity = activity_from_trace(_trace("file_indexing", "retry"), 1)

    assert activity is not None
    assert activity["status"] == "indexing"


def test_activity_from_trace_ignores_unmapped_trace() -> None:
    assert activity_from_trace(_trace("qdrant_read", "ok"), 1) is None


def test_activity_from_trace_ignores_provider_failure_without_file_metadata() -> None:
    trace = SyncTraceItem(
        timestamp="2026-09-25T00:00:00+00:00",
        provider="dropbox",
        step="qdrant_read",
        status="failed",
        detail="internal failure",
    )

    assert activity_from_trace(trace, 1) is None
