"""Unit tests for storage provider adapters."""

from dataclasses import dataclass
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from backend.app.config import Settings
from backend.app.storage.client import (
    DROPBOX_PROVIDER,
    GOOGLE_DRIVE_PROVIDER,
    DisabledStorageClient,
    DropboxClient,
    GoogleDriveClient,
    StorageFile,
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
                        "name": "note.txt",
                        "mimeType": "text/plain",
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
    assert [file.storage_file_id for file in files] == ["image", "file"]
    assert all(file.provider == GOOGLE_DRIVE_PROVIDER for file in files)
    assert files[0].source_url == "https://drive.google.com/file/d/image/view"


@pytest.mark.unit
def test_dropbox_lists_paged_supported_files_and_downloads() -> None:
    metadata = SimpleNamespace(
        id="id-1",
        path_display="/team/note.txt",
        name="note.txt",
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
    assert files[0].provider == DROPBOX_PROVIDER
    assert files[0].modified_time == datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert downloaded.file.modified_time == datetime(2026, 8, 1, tzinfo=timezone.utc)
    assert downloaded.content == b"hello"


@pytest.mark.unit
def test_storage_file_is_immutable() -> None:
    file = StorageFile(
        GOOGLE_DRIVE_PROVIDER, "id", "x", "text/plain", datetime.now(timezone.utc), 0
    )
    with pytest.raises((AttributeError, TypeError)):
        file.name = "changed"  # type: ignore[misc]


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

    def files_list_folder(self, root: str, recursive: bool) -> _DropboxPage:  # noqa: ARG002
        return _DropboxPage(self._first, True)

    def files_list_folder_continue(self, cursor: str) -> _DropboxPage:  # noqa: ARG002
        return _DropboxPage(self._second, False)

    def files_download(self, storage_file_id: str) -> tuple[object, object]:  # noqa: ARG002
        return self._metadata, SimpleNamespace(content=b"hello")
