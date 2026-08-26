"""Provider-scoped storage snapshot reconciliation."""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.app.integrations.qdrant_store import PAYLOAD_MODIFIED_TIME, SearchHit
from backend.app.storage.client import StorageFile


@dataclass(frozen=True)
class SyncPlan:
    to_upsert: list[StorageFile] = field(default_factory=list)
    to_delete_point_ids: list[str] = field(default_factory=list)
    unchanged: list[StorageFile] = field(default_factory=list)


class SyncState:
    def __init__(self, files: list[StorageFile], stored_hits: list[SearchHit]) -> None:
        self._files = {file.storage_file_id: file for file in files}
        self._stored = {
            str(hit.payload["storage_file_id"]): hit
            for hit in stored_hits
            if isinstance(hit.payload.get("storage_file_id"), str)
            and isinstance(hit.payload.get(PAYLOAD_MODIFIED_TIME), str)
        }

    @classmethod
    def seed_from_qdrant(
        cls, files: list[StorageFile], stored_hits: list[SearchHit]
    ) -> "SyncState":
        return cls(files, stored_hits)

    def diff(self) -> SyncPlan:
        upsert: list[StorageFile] = []
        unchanged: list[StorageFile] = []
        for storage_file_id, file in self._files.items():
            hit = self._stored.get(storage_file_id)
            if (
                hit is None
                or _parse_modified(hit.payload[PAYLOAD_MODIFIED_TIME])
                < file.modified_time
            ):
                upsert.append(file)
            else:
                unchanged.append(file)
        deleted = [
            hit.point_id for key, hit in self._stored.items() if key not in self._files
        ]
        return SyncPlan(upsert, deleted, unchanged)


def _parse_modified(raw: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return datetime.fromtimestamp(0, tz=timezone.utc)
