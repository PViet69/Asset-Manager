"""Storage-provider clients for Google Drive and Dropbox."""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any, Protocol
from urllib.parse import quote

from backend.app.config import Settings

logger = logging.getLogger(__name__)

GOOGLE_DRIVE_PROVIDER = "google_drive"
DROPBOX_PROVIDER = "dropbox"
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
_THUMBNAIL_MIME_TYPES: frozenset[str] = frozenset(
    {"image/png", "image/jpeg", "image/webp"}
)

_EXTENSION_MIMES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}


@dataclass(frozen=True)
class StorageFile:
    provider: str
    storage_file_id: str
    name: str
    mime_type: str
    modified_time: datetime
    size: int
    source_url: str | None = None


@dataclass(frozen=True)
class DownloadedStorageFile:
    file: StorageFile
    content: bytes
    export_mime_type: str | None = None


@dataclass(frozen=True)
class Thumbnail:
    content: bytes
    media_type: str


class StorageThumbnailUnavailable(Exception):
    """Raised when a provider cannot produce a thumbnail."""

    def __init__(self) -> None:
        super().__init__("Storage thumbnail unavailable")


class StorageThumbnailNotFound(Exception):
    """Raised when a provider thumbnail source no longer exists."""

    def __init__(self) -> None:
        super().__init__("Storage thumbnail not found")


class StorageClient(Protocol):
    def list_files(self, root: str) -> list[StorageFile]: ...
    def download(self, storage_file_id: str) -> DownloadedStorageFile: ...
    def get_thumbnail(self, storage_file_id: str) -> Thumbnail: ...
    def check_health(self) -> str: ...


class DisabledStorageClient:
    def __init__(self, provider: str) -> None:
        self._provider = provider

    def list_files(self, root: str) -> list[StorageFile]:  # noqa: ARG002
        return []

    def download(self, storage_file_id: str) -> DownloadedStorageFile:  # noqa: ARG002
        raise RuntimeError(f"{self._provider} sync is not configured")

    def get_thumbnail(self, storage_file_id: str) -> Thumbnail:  # noqa: ARG002
        raise StorageThumbnailUnavailable()

    def check_health(self) -> str:
        return "disabled"


def is_google_drive_configured(settings: Settings) -> bool:
    return bool(settings.DRIVE_SERVICE_ACCOUNT_JSON and settings.DRIVE_FOLDER_ID)


def is_dropbox_configured(settings: Settings) -> bool:
    return bool(
        settings.DROPBOX_APP_KEY
        and settings.DROPBOX_APP_SECRET
        and settings.DROPBOX_REFRESH_TOKEN
        and settings.DROPBOX_ROOT_PATH
    )


def build_google_drive_client(settings: Settings) -> StorageClient:
    if not is_google_drive_configured(settings):
        return DisabledStorageClient(GOOGLE_DRIVE_PROVIDER)
    return GoogleDriveClient(
        json.loads(settings.DRIVE_SERVICE_ACCOUNT_JSON), settings.DRIVE_FOLDER_ID
    )  # type: ignore[arg-type]


def build_dropbox_client(settings: Settings) -> StorageClient:
    if not is_dropbox_configured(settings):
        return DisabledStorageClient(DROPBOX_PROVIDER)
    return DropboxClient(
        settings.DROPBOX_APP_KEY,
        settings.DROPBOX_APP_SECRET,
        settings.DROPBOX_REFRESH_TOKEN,
        settings.DROPBOX_ROOT_PATH,
    )  # type: ignore[arg-type]


def _parse_modified_time(raw: str | None) -> datetime:
    if not raw:
        return datetime.fromtimestamp(0, tz=timezone.utc)
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Failed parsing storage modified timestamp")
        return datetime.fromtimestamp(0, tz=timezone.utc)


class GoogleDriveClient:
    def __init__(
        self, service_account_info: dict[str, Any], root_folder_id: str
    ) -> None:
        from google.auth.transport.requests import AuthorizedSession
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        credentials = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=["https://www.googleapis.com/auth/drive.readonly"],
        )
        self._service = build(
            "drive", "v3", credentials=credentials, cache_discovery=False
        )
        self._thumbnail_session = AuthorizedSession(credentials)
        self._root_folder_id = root_folder_id

    def list_files(self, root: str) -> list[StorageFile]:
        files: list[StorageFile] = []
        self._walk(root, files)
        return files

    def _walk(self, folder_id: str, output: list[StorageFile]) -> None:
        page_token: str | None = None
        while True:
            response = (
                self._service.files()
                .list(
                    q=f"'{folder_id}' in parents and trashed = false",
                    fields="nextPageToken,files(id,name,mimeType,modifiedTime,size,parents)",
                    pageToken=page_token,
                    pageSize=100,
                )
                .execute()
            )
            for item in response.get("files", []):
                file = _to_google_file(item)
                if file.mime_type == "application/vnd.google-apps.folder":
                    self._walk(file.storage_file_id, output)
                elif file.mime_type in _SUPPORTED_MIMES:
                    output.append(file)
            page_token = response.get("nextPageToken")
            if not page_token:
                return

    def download(self, storage_file_id: str) -> DownloadedStorageFile:
        metadata = (
            self._service.files()
            .get(
                fileId=storage_file_id,
                fields="id,name,mimeType,modifiedTime,size,parents",
            )
            .execute()
        )
        file = _to_google_file(metadata)
        export_mime = _GOOGLE_NATIVE_MIMES.get(file.mime_type)
        if export_mime:
            content = (
                self._service.files()
                .export(fileId=storage_file_id, mimeType=export_mime)
                .execute()
            )
        else:
            content = self._service.files().get_media(fileId=storage_file_id).execute()
        return DownloadedStorageFile(
            file, content if isinstance(content, bytes) else b"", export_mime
        )

    def get_thumbnail(self, storage_file_id: str) -> Thumbnail:
        try:
            metadata = (
                self._service.files()
                .get(fileId=storage_file_id, fields="thumbnailLink")
                .execute()
            )
            thumbnail_link = metadata.get("thumbnailLink")
            if not isinstance(thumbnail_link, str) or not thumbnail_link:
                raise StorageThumbnailUnavailable()
            response = self._thumbnail_session.get(thumbnail_link)
            media_type = str(response.headers.get("content-type", "")).split(";", 1)[0]
            content = bytes(response.content)
            if (
                not response.ok
                or media_type not in _THUMBNAIL_MIME_TYPES
                or not content
            ):
                raise StorageThumbnailUnavailable()
            return Thumbnail(content, media_type)
        except StorageThumbnailUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise StorageThumbnailUnavailable() from exc

    def check_health(self) -> str:
        try:
            self._service.files().get(
                fileId=self._root_folder_id, fields="id"
            ).execute()
        except Exception:  # noqa: BLE001
            logger.warning("Google Drive health check failed", exc_info=True)
            return "unavailable"
        return "ok"


def _to_google_file(item: dict[str, Any]) -> StorageFile:
    storage_file_id = str(item["id"])
    return StorageFile(
        GOOGLE_DRIVE_PROVIDER,
        storage_file_id,
        str(item.get("name", "")),
        str(item.get("mimeType", "")),
        _parse_modified_time(item.get("modifiedTime")),
        int(item.get("size") or 0),
        f"https://drive.google.com/file/d/{quote(storage_file_id, safe='')}/view",
    )


class DropboxClient:
    def __init__(
        self, app_key: str, app_secret: str, refresh_token: str, root_path: str
    ) -> None:
        import dropbox

        self._client = dropbox.Dropbox(
            oauth2_refresh_token=refresh_token, app_key=app_key, app_secret=app_secret
        )
        self._root_path = root_path

    @classmethod
    def from_client(cls, client: Any, root_path: str) -> "DropboxClient":
        instance = cls.__new__(cls)
        instance._client = client
        instance._root_path = root_path
        return instance

    def list_files(self, root: str) -> list[StorageFile]:
        page = self._client.files_list_folder(root, recursive=True)
        entries = list(page.entries)
        while page.has_more:
            page = self._client.files_list_folder_continue(page.cursor)
            entries.extend(page.entries)
        return [
            file for entry in entries if (file := _to_dropbox_file(entry)) is not None
        ]

    def download(self, storage_file_id: str) -> DownloadedStorageFile:
        metadata, response = self._client.files_download(storage_file_id)
        file = _to_dropbox_file(metadata, require_supported=False)
        if file is None:
            raise RuntimeError("Dropbox download metadata is invalid")
        return DownloadedStorageFile(file, bytes(response.content))

    def get_thumbnail(self, storage_file_id: str) -> Thumbnail:
        try:
            from dropbox import files

            _, response = self._client.files_get_thumbnail_v2(
                files.PathOrLink.path(storage_file_id),
                format=files.ThumbnailFormat.jpeg,
                size=files.ThumbnailSize.w256h256,
                mode=files.ThumbnailMode.strict,
                exclude_media_info=True,
            )
            content = bytes(response.content)
            if not content:
                raise StorageThumbnailUnavailable()
            return Thumbnail(content, "image/jpeg")
        except StorageThumbnailUnavailable:
            raise
        except Exception as exc:  # noqa: BLE001
            raise StorageThumbnailUnavailable() from exc

    def check_health(self) -> str:
        try:
            self._client.files_get_metadata(self._root_path)
        except Exception:  # noqa: BLE001
            logger.warning("Dropbox health check failed", exc_info=True)
            return "unavailable"
        return "ok"


def _to_dropbox_file(entry: Any, require_supported: bool = True) -> StorageFile | None:
    path = getattr(entry, "path_display", None)
    file_id = getattr(entry, "id", None)
    if not isinstance(path, str) or not isinstance(file_id, str):
        return None
    mime_type = _EXTENSION_MIMES.get(PurePosixPath(path).suffix.lower())
    if require_supported and mime_type not in _SUPPORTED_MIMES:
        return None
    modified_time = getattr(
        entry, "client_modified", datetime.fromtimestamp(0, tz=timezone.utc)
    )
    if modified_time.tzinfo is None:
        modified_time = modified_time.replace(tzinfo=timezone.utc)
    return StorageFile(
        DROPBOX_PROVIDER,
        file_id,
        str(getattr(entry, "name", PurePosixPath(path).name)),
        mime_type or "application/octet-stream",
        modified_time,
        int(getattr(entry, "size", 0)),
        f"https://www.dropbox.com/home{quote(path, safe='/')}",
    )
