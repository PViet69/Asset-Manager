"""Unit tests for storage provider adapters."""

import logging
import ssl
from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from backend.app.config import Settings
from backend.app.storage import StorageProvider
from backend.app.storage.client import (
    DisabledStorageClient,
    DropboxClient,
    GoogleDriveClient,
    StorageFile,
    StorageThumbnailUnavailable,
    Thumbnail,
    build_google_drive_client,
    is_dropbox_configured,
    is_google_drive_configured,
)


def _settings(**overrides: object) -> Settings:
    values = {
        "MODEL_ENDPOINT_URL": "https://model.example",
        "DESCRIPTION_MODEL": "vision-model",
        "DESCRIPTION_ENDPOINT_URL": "https://vision.example",
        "DESCRIPTION_ENDPOINT_API_KEY": "vision-key",
        "EMBEDDING_MODEL": "embedding-model",
        "QDRANT_URL": "https://qdrant.example",
        "QDRANT_VECTOR_SIZE": 2,
    }
    return Settings(_env_file=None, **(values | overrides))


@pytest.mark.unit
def test_provider_configuration_is_independent() -> None:
    settings = _settings(DRIVE_FOLDER_ID="folder")
    assert is_google_drive_configured(settings) is False
    assert is_dropbox_configured(settings) is False


@pytest.mark.unit
def test_unconfigured_google_drive_returns_disabled_client() -> None:
    client = build_google_drive_client(_settings())
    assert isinstance(client, DisabledStorageClient)
    assert client.list_files("root") == []
    assert client.check_health() == "disabled"


@pytest.mark.unit
def test_google_drive_health_failure_logs_without_traceback(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._root_folder_id = "root"
    files = Mock()
    files.get.return_value = Mock(
        execute=Mock(side_effect=ssl.SSLError("record layer failure"))
    )
    client._service = Mock(files=Mock(return_value=files))

    with caplog.at_level(logging.WARNING):
        health = client.check_health()

    assert health == "unavailable"
    assert "Google Drive health check failed" in caplog.text
    assert "Traceback" not in caplog.text


@pytest.mark.unit
def test_google_drive_lists_recursively_and_maps_provider_metadata() -> None:
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _DriveService(
        {
            "root": {
                "files": [
                    {
                        "id": "folder",
                        "name": "nested",
                        "mimeType": "application/vnd.google-apps.folder",
                    },
                    {
                        "id": "file",
                        "name": "unsupported.bin",
                        "mimeType": "application/octet-stream",
                        "modifiedTime": "2026-08-01T00:00:00Z",
                    },
                ]
            },
            "folder": {
                "files": [
                    {
                        "id": "image",
                        "name": "image.png",
                        "mimeType": "image/png",
                        "modifiedTime": "2026-08-02T00:00:00Z",
                    }
                ]
            },
        }
    )
    files = client.list_files("root")
    assert [file.storage_file_id for file in files] == ["image"]
    assert all(file.provider == StorageProvider.GOOGLE_DRIVE for file in files)
    assert files[0].source_url == "https://drive.google.com/file/d/image/view"


@pytest.mark.unit
def test_dropbox_lists_paged_supported_files_and_downloads() -> None:
    metadata = SimpleNamespace(
        id="id-1",
        path_display="/team/image.png",
        name="image.png",
        size=5,
        client_modified=datetime(2026, 8, 1),
    )
    ignored = SimpleNamespace(
        id="id-2",
        path_display="/team/app.exe",
        name="app.exe",
        size=5,
        client_modified=datetime.now(timezone.utc),
    )
    client = DropboxClient.from_client(
        _DropboxSdk([metadata], [ignored], metadata), "/team"
    )
    files = client.list_files("/team")
    downloaded = client.download("id-1")
    assert [file.storage_file_id for file in files] == ["id-1"]
    assert files[0].provider == StorageProvider.DROPBOX
    assert files[0].modified_time == datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert downloaded.file.modified_time == datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert downloaded.content == b"hello"


@pytest.mark.unit
def test_storage_file_is_immutable() -> None:
    file = StorageFile(
        StorageProvider.GOOGLE_DRIVE,
        "id",
        "x.png",
        "image/png",
        datetime.now(timezone.utc),
        0,
    )

    with pytest.raises((AttributeError, TypeError)):
        file.name = "changed"  # type: ignore[misc]


@pytest.mark.unit
def test_disabled_storage_thumbnail_raises_safe_unavailable_error() -> None:
    with pytest.raises(StorageThumbnailUnavailable, match="thumbnail unavailable"):
        DisabledStorageClient(StorageProvider.DROPBOX).get_thumbnail("id:photo")


@pytest.mark.unit
def test_dropbox_thumbnail_uses_thumbnail_endpoint_not_source_download() -> None:
    sdk = _DropboxSdk([], [], SimpleNamespace())
    sdk.files_get_thumbnail_v2 = Mock(
        return_value=(SimpleNamespace(), SimpleNamespace(content=b"small-jpeg"))
    )
    client = DropboxClient.from_client(sdk, "/team")

    thumbnail = client.get_thumbnail("id:photo")

    assert thumbnail == Thumbnail(b"small-jpeg", "image/jpeg")
    thumbnail_call = sdk.files_get_thumbnail_v2.call_args
    assert thumbnail_call is not None
    assert thumbnail_call.args[0].is_path()
    assert thumbnail_call.args[0].get_path() == "id:photo"
    assert sdk.files_download.call_count == 0


@pytest.mark.unit
def test_google_drive_thumbnail_fetches_authenticated_thumbnail_link() -> None:
    service = _ThumbnailDriveService("https://thumbnail.example/image")
    response = SimpleNamespace(
        ok=True,
        content=b"small-png",
        headers={"content-type": "image/png"},
    )
    session = Mock()
    session.get.return_value = response
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = service
    client._thumbnail_session = session

    thumbnail = client.get_thumbnail("drive-photo")

    assert thumbnail == Thumbnail(b"small-png", "image/png")
    service.files().get.assert_called_once_with(
        fileId="drive-photo", fields="thumbnailLink"
    )
    session.get.assert_called_once_with("https://thumbnail.example/image")
    service.files().get_media.assert_not_called()


@pytest.mark.unit
def test_provider_thumbnail_failure_hides_provider_error_details() -> None:
    sdk = _DropboxSdk([], [], SimpleNamespace())
    sdk.files_get_thumbnail_v2 = Mock(side_effect=RuntimeError("provider secret"))

    with pytest.raises(StorageThumbnailUnavailable) as raised:
        DropboxClient.from_client(sdk, "/team").get_thumbnail("id:photo")

    assert "provider secret" not in str(raised.value)


class _Call:
    def __init__(self, response: object) -> None:
        self._response = response

    def execute(self) -> object:
        return self._response


class _DriveFiles:
    def __init__(self, pages: dict[str, dict]) -> None:
        self._pages = pages

    def list(self, q: str, **_: object) -> _Call:
        return _Call(self._pages[q.split("'")[1]])


class _DriveService:
    def __init__(self, pages: dict[str, dict]) -> None:
        self._files = _DriveFiles(pages)

    def files(self) -> _DriveFiles:
        return self._files


class _ThumbnailDriveService:
    def __init__(self, thumbnail_link: str) -> None:
        self._files = Mock()
        self._files.get.return_value = _Call({"thumbnailLink": thumbnail_link})

    def files(self) -> Mock:
        return self._files


@dataclass
class _DropboxPage:
    entries: list[object]
    has_more: bool
    cursor: str = "next"


class _DropboxSdk:
    def __init__(
        self, first: list[object], second: list[object], metadata: object
    ) -> None:
        self._first = first
        self._second = second
        self._metadata = metadata
        self.files_download = Mock(
            return_value=(self._metadata, SimpleNamespace(content=b"hello"))
        )

    def files_list_folder(self, root: str, recursive: bool) -> _DropboxPage:  # noqa: ARG002
        return _DropboxPage(self._first, True)

    def files_list_folder_continue(self, cursor: str) -> _DropboxPage:  # noqa: ARG002
        return _DropboxPage(self._second, False)

    def files_download(self, storage_file_id: str) -> tuple[object, object]:  # noqa: ARG002
        return self._metadata, SimpleNamespace(content=b"hello")
