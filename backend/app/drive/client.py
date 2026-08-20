"""Google Drive client: folder traversal, download, and health checks."""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from backend.app.config import Settings

logger = logging.getLogger(__name__)


# MIME types for Google-native files that need export (not direct download).
_GOOGLE_NATIVE_MIMES: dict[str, str] = {
    "application/vnd.google-apps.document": (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ),
    "application/vnd.google-apps.spreadsheet": (
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    ),
    "application/vnd.google-apps.presentation": (
        "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    ),
    "application/vnd.google-apps.drawing": "image/png",
}

# Subset of mime types the asset pipeline accepts.
_SUPPORTED_MIMES: frozenset[str] = frozenset(
    {
        "text/plain",
        "text/markdown",
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        *_GOOGLE_NATIVE_MIMES,
    }
)


@dataclass(frozen=True)
class DriveFile:
    """A single Drive file metadata snapshot."""

    id: str
    name: str
    mime_type: str
    modified_time: datetime
    size: int
    parents: tuple[str, ...] = ()


@dataclass(frozen=True)
class DownloadedFile:
    """A downloaded Drive file's bytes + metadata."""

    file: DriveFile
    content: bytes
    export_mime_type: str | None = None


class DriveClient(Protocol):
    """Minimal Drive client used by the sync scheduler and health route."""

    def traverse_folder(self, folder_id: str) -> list[DriveFile]: ...
    def download(self, drive_id: str) -> DownloadedFile: ...
    def check_health(self) -> str: ...


class DisabledDriveClient:
    """Stand-in client used when Drive is not configured."""

    def traverse_folder(self, folder_id: str) -> list[DriveFile]:  # noqa: ARG002
        return []

    def download(self, drive_id: str) -> DownloadedFile:  # noqa: ARG002
        raise RuntimeError("Drive sync is not configured")

    def check_health(self) -> str:
        return "disabled"


def is_configured(settings: Settings) -> bool:
    """True iff the necessary Drive credentials are present."""
    return bool(settings.DRIVE_SERVICE_ACCOUNT_JSON and settings.DRIVE_FOLDER_ID)


def build_drive_client(settings: Settings) -> DriveClient:
    """Construct the appropriate DriveClient based on settings."""
    if not is_configured(settings):
        return DisabledDriveClient()
    return GoogleDriveClient(
        service_account_info=json.loads(settings.DRIVE_SERVICE_ACCOUNT_JSON),  # type: ignore[arg-type]
        root_folder_id=settings.DRIVE_FOLDER_ID,  # type: ignore[arg-type]
    )


def _parse_modified_time(raw: str | None) -> datetime:
    """Parse Drive's RFC 3339 timestamps; fall back to epoch on absence."""
    if not raw:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        # Drive returns RFC 3339 with timezone offset, e.g. 2026-08-01T12:34:56.000Z.
        normalized = raw.replace("Z", "+00:00")
        return datetime.fromisoformat(normalized)
    except ValueError:
        logger.warning("Failed to parse Drive modifiedTime: %s", raw)
        return datetime.fromtimestamp(0, tz=timezone.utc)


class GoogleDriveClient:
    """Concrete DriveClient backed by googleapiclient (blocking calls)."""

    def __init__(
        self,
        service_account_info: dict[str, Any],
        root_folder_id: str,
    ) -> None:
        # Imported lazily so import errors stay isolated to Drive usage.
        from google.oauth2 import service_account as _sa
        from googleapiclient.discovery import build as _build

        credentials = _sa.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        self._service = _build(
            "drive", "v3", credentials=credentials, cache_discovery=False
        )
        self._root_folder_id = root_folder_id

    def traverse_folder(self, folder_id: str) -> list[DriveFile]:
        """Recursively list supported files under ``folder_id``."""
        files: list[DriveFile] = []
        self._walk(folder_id, files)
        return files

    def _walk(self, folder_id: str, output: list[DriveFile]) -> None:
        page_token: str | None = None
        while True:
            params: dict[str, Any] = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "fields": (
                    "nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)"
                ),
                "pageToken": page_token,
                "pageSize": 100,
            }
            response = self._service.files().list(**params).execute()
            for item in response.get("files", []):
                file = _to_drive_file(item)
                if file.mime_type == "application/vnd.google-apps.folder":
                    self._walk(file.id, output)
                elif file.mime_type in _SUPPORTED_MIMES:
                    output.append(file)
            page_token = response.get("nextPageToken")
            if not page_token:
                return

    def download(self, drive_id: str) -> DownloadedFile:
        """Download bytes; export Google-native files to a portable format."""
        meta = (
            self._service.files()
            .get(
                fileId=drive_id,
                fields="id,name,mimeType,modifiedTime,size,parents",
            )
            .execute()
        )
        file = _to_drive_file(meta)
        export_mime = _GOOGLE_NATIVE_MIMES.get(file.mime_type)
        if export_mime is not None:
            content = (
                self._service.files()
                .export(fileId=drive_id, mimeType=export_mime)
                .execute()
            )
            if not isinstance(content, bytes):
                content = str(content).encode("utf-8")
        else:
            content = self._service.files().get_media(fileId=drive_id).execute()
        if not isinstance(content, bytes):
            content = b""
        return DownloadedFile(file=file, content=content, export_mime_type=export_mime)

    def check_health(self) -> str:
        """Return Drive availability without leaking client errors."""
        try:
            self._service.files().get(
                fileId=self._root_folder_id, fields="id"
            ).execute()
        except Exception:  # noqa: BLE001
            logger.warning("Drive health check failed", exc_info=True)
            return "unavailable"
        return "ok"


def _to_drive_file(item: dict[str, Any]) -> DriveFile:
    parents = tuple(item.get("parents") or ())
    size_raw = item.get("size")
    return DriveFile(
        id=item["id"],
        name=item.get("name", ""),
        mime_type=item.get("mimeType", ""),
        modified_time=_parse_modified_time(item.get("modifiedTime")),
        size=int(size_raw) if size_raw is not None else 0,
        parents=parents,
    )
