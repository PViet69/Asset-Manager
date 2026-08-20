"""Sync bookkeeping: diff Drive-snapshot against known Qdrant state."""

from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.app.drive.client import DriveFile
from backend.app.integrations.qdrant_store import PAYLOAD_MODIFIED_TIME, SearchHit


@dataclass(frozen=True)
class SyncPlan:
    """Diff between a Drive snapshot and the currently stored Qdrant state."""

    to_upsert: list[DriveFile] = field(default_factory=list)
    to_delete_point_ids: list[str] = field(default_factory=list)
    unchanged: list[DriveFile] = field(default_factory=list)

    @property
    def upsert_count(self) -> int:
        return len(self.to_upsert)

    @property
    def delete_count(self) -> int:
        return len(self.to_delete_point_ids)

    @property
    def is_empty(self) -> bool:
        return not self.to_upsert and not self.to_delete_point_ids


class SyncState:
    """Track the set of drive_ids already known to Qdrant for fast diffs."""

    def __init__(
        self, drive_files: list[DriveFile], stored_hits: list[SearchHit]
    ) -> None:
        self._by_drive_id: dict[str, tuple[DriveFile, str]] = {}
        for hit in stored_hits:
            drive_id = hit.payload.get("drive_id")
            if not isinstance(drive_id, str):
                continue
            self._by_drive_id[drive_id] = (_hit_to_drive_file(hit), hit.point_id)

        self._drive_by_id: dict[str, DriveFile] = {
            file.id: file for file in drive_files
        }

    @classmethod
    def seed_from_qdrant(
        cls,
        drive_files: list[DriveFile],
        stored_hits: list[SearchHit],
    ) -> "SyncState":
        """Build a SyncState from a fresh Drive snapshot + existing Qdrant points."""
        return cls(drive_files, stored_hits)

    def diff(self) -> SyncPlan:
        """Compare current Drive snapshot against known ids."""
        plan = SyncPlan()
        seen: set[str] = set()
        for drive_id, file in self._drive_by_id.items():
            seen.add(drive_id)
            known = self._by_drive_id.get(drive_id)
            if known is None:
                plan.to_upsert.append(file)
                continue
            stored_file, _ = known
            if _stored_modified(stored_file) >= file.modified_time:
                plan.unchanged.append(file)
            else:
                plan.to_upsert.append(file)
        for drive_id, (stored_file, point_id) in self._by_drive_id.items():
            if drive_id in seen:
                continue
            # Stored file is no longer present in Drive → delete it.
            _ = stored_file  # retain for potential future logging
            plan.to_delete_point_ids.append(point_id)
        return plan

    def record_upserted(self, drive_file: DriveFile, point_id: str) -> None:
        """Mark a Drive file as known after a successful upsert."""
        self._drive_by_id[drive_file.id] = drive_file
        self._by_drive_id[drive_file.id] = (drive_file, point_id)

    def record_deleted(self, point_id: str) -> None:
        """Forget a point that was just removed from Qdrant."""
        self._by_drive_id = {
            drive_id: (file, pid)
            for drive_id, (file, pid) in self._by_drive_id.items()
            if pid != point_id
        }


def _hit_to_drive_file(hit: SearchHit) -> DriveFile:
    """Reconstruct a minimal DriveFile from a stored Qdrant hit's payload."""
    payload = hit.payload
    return DriveFile(
        id=str(payload.get("drive_id", "")),
        name=str(payload.get("filename", "")),
        mime_type=str(payload.get("file_type", "")),
        modified_time=_parse_stored_modified_time(payload[PAYLOAD_MODIFIED_TIME]),
        size=0,
        parents=(),
    )


def _stored_modified(stored: DriveFile) -> datetime:
    """Pull the ``modified_time`` field back out of a stored DriveFile."""
    return stored.modified_time


def _parse_stored_modified_time(raw: object) -> datetime:
    """Parse the ISO-8601 string we stored in payload; fall back to epoch."""
    if not isinstance(raw, str) or not raw:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed
