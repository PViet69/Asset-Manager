"""Safe public activity derived from internal scheduler traces."""

from backend.app.api.schemas.admin import SyncTraceItem
from backend.app.tasks.job_store import SyncJobActivity


def activity_from_trace(trace: SyncTraceItem, sequence: int) -> SyncJobActivity | None:
    """Map allowlisted scheduler traces without exposing trace contents."""
    status = _activity_status(trace)
    if status is None or trace.filename is None or trace.storage_file_id is None:
        return None
    return {
        "sequence": sequence,
        "storage_file_id": trace.storage_file_id,
        "filename": trace.filename,
        "status": status,
        "embedded_delta": trace.embedded_delta if status == "indexed" else 0,
    }


def _activity_status(trace: SyncTraceItem) -> str | None:
    if trace.step == "file_prepare" and trace.status == "ok":
        return "preparing"
    if trace.step == "file_indexing" and trace.status == "ok":
        return "indexing"
    if trace.step == "file_indexing" and trace.status == "retry":
        return "indexing"
    if trace.step == "file_ingestion" and trace.status == "ok":
        return "indexed"
    if trace.step == "file_ingestion" and trace.status == "failed":
        return "failed"
    if trace.step == "sync_cancel":
        return "stopped"
    if (
        trace.step in {"provider_traversal", "qdrant_read", "qdrant_delete"}
        and trace.status == "failed"
    ):
        return "failed"
    return None
