"""Unit tests for backend.app.drive.client."""

from datetime import datetime, timezone

import pytest

from backend.app.config import Settings
from backend.app.drive.client import (
    DisabledDriveClient,
    DriveClient,
    DriveFile,
    GoogleDriveClient,
    build_drive_client,
    is_configured,
)


def _settings(**overrides: object) -> Settings:
    base = dict(
        MODEL_ENDPOINT_URL="https://model.example",
        DESCRIPTION_MODEL="vision-model",
        DESCRIPTION_ENDPOINT_URL="https://vision.example",
        DESCRIPTION_ENDPOINT_API_KEY="vision-key",
        EMBEDDING_MODEL="embedding-model",
        QDRANT_URL="https://qdrant.example",
        QDRANT_VECTOR_SIZE=2,
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.mark.unit
def test_is_configured_false_when_service_account_missing() -> None:
    settings = _settings(DRIVE_FOLDER_ID="folder")

    assert is_configured(settings) is False


@pytest.mark.unit
def test_is_configured_false_when_folder_id_missing() -> None:
    settings = _settings(DRIVE_SERVICE_ACCOUNT_JSON='{"a":1}')

    assert is_configured(settings) is False


@pytest.mark.unit
def test_is_configured_true_when_both_present() -> None:
    settings = _settings(DRIVE_SERVICE_ACCOUNT_JSON='{"a":1}', DRIVE_FOLDER_ID="folder")

    assert is_configured(settings) is True


@pytest.mark.unit
def test_build_returns_disabled_when_not_configured() -> None:
    settings = _settings()

    client = build_drive_client(settings)

    assert isinstance(client, DisabledDriveClient)


@pytest.mark.unit
def test_disabled_client_traverse_returns_empty_list() -> None:
    client: DriveClient = DisabledDriveClient()

    assert client.traverse_folder("anything") == []


@pytest.mark.unit
def test_disabled_client_download_raises() -> None:
    client: DriveClient = DisabledDriveClient()

    with pytest.raises(RuntimeError, match="not configured"):
        client.download("drive-1")


@pytest.mark.unit
def test_disabled_client_check_health_reports_disabled() -> None:
    client: DriveClient = DisabledDriveClient()

    assert client.check_health() == "disabled"


@pytest.mark.unit
def test_google_drive_client_traverses_and_deduplicates_supported_files() -> None:
    files_resource = _FakeFilesResource(
        responses_by_folder={
            "root": [
                {
                    "files": [
                        {
                            "id": "file-1",
                            "name": "photo.png",
                            "mimeType": "image/png",
                            "modifiedTime": "2026-08-01T12:34:56Z",
                            "size": "1024",
                            "parents": ["root"],
                        },
                        {
                            "id": "sub-1",
                            "name": "subfolder",
                            "mimeType": ("application/vnd.google-apps.folder"),
                            "modifiedTime": "2026-08-01T00:00:00Z",
                        },
                        {
                            "id": "file-2",
                            "name": "unsupported.exe",
                            "mimeType": "application/x-msdownload",
                            "modifiedTime": "2026-08-01T00:00:00Z",
                        },
                    ],
                    "nextPageToken": "page-2",
                },
                {
                    "files": [
                        {
                            "id": "file-3",
                            "name": "note.txt",
                            "mimeType": "text/plain",
                            "modifiedTime": "2026-08-02T08:00:00Z",
                            "size": "256",
                        }
                    ]
                },
            ],
            "sub-1": [
                {
                    "files": [
                        {
                            "id": "file-4",
                            "name": "deep.png",
                            "mimeType": "image/png",
                            "modifiedTime": "2026-08-03T08:00:00Z",
                            "size": "512",
                            "parents": ["sub-1"],
                        }
                    ]
                }
            ],
        }
    )
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _ServiceStub(files_resource)
    client._root_folder_id = "root"

    files = client.traverse_folder("root")

    assert [file.id for file in files] == ["file-1", "file-4", "file-3"]
    assert files[0].size == 1024
    assert files[0].modified_time == datetime(
        2026, 8, 1, 12, 34, 56, tzinfo=timezone.utc
    )


@pytest.mark.unit
def test_google_drive_client_download_uses_export_for_google_native() -> None:
    files_resource = _FakeFilesResource(
        meta={
            "id": "doc-1",
            "name": "doc.docx",
            "mimeType": "application/vnd.google-apps.document",
            "modifiedTime": "2026-08-01T00:00:00Z",
        },
        export_payload=b"docx-bytes",
    )
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _ServiceStub(files_resource)
    client._root_folder_id = "root"

    downloaded = client.download("doc-1")

    assert downloaded.file.id == "doc-1"
    assert downloaded.export_mime_type is not None
    assert downloaded.content == b"docx-bytes"


@pytest.mark.unit
def test_google_drive_client_download_uses_media_for_regular_file() -> None:
    files_resource = _FakeFilesResource(
        meta={
            "id": "img-1",
            "name": "img.png",
            "mimeType": "image/png",
            "modifiedTime": "2026-08-01T00:00:00Z",
            "size": "10",
        },
        media_payload=b"\x89PNG-fake",
    )
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _ServiceStub(files_resource)
    client._root_folder_id = "root"

    downloaded = client.download("img-1")

    assert downloaded.export_mime_type is None
    assert downloaded.content == b"\x89PNG-fake"


@pytest.mark.unit
def test_google_drive_client_check_health_returns_ok_on_success() -> None:
    files_resource = _FakeFilesResource()
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _ServiceStub(files_resource)
    client._root_folder_id = "root"

    assert client.check_health() == "ok"


@pytest.mark.unit
def test_google_drive_client_check_health_returns_unavailable_on_error() -> None:
    files_resource = _FakeFilesResource(fail_get=True)
    client = GoogleDriveClient.__new__(GoogleDriveClient)
    client._service = _ServiceStub(files_resource)
    client._root_folder_id = "root"

    assert client.check_health() == "unavailable"


@pytest.mark.unit
def test_drive_file_is_immutable() -> None:
    file = DriveFile(
        id="x",
        name="x",
        mime_type="text/plain",
        modified_time=datetime.now(timezone.utc),
        size=0,
    )

    with pytest.raises((AttributeError, TypeError)):
        file.id = "y"  # type: ignore[misc]


# -------- fakes -----------------------------------------------------------


class _FakeFilesResource:
    def __init__(
        self,
        page_responses: list[dict] | None = None,
        responses_by_folder: dict[str, list[dict]] | None = None,
        meta: dict | None = None,
        export_payload: bytes | None = None,
        media_payload: bytes | None = None,
        fail_get: bool = False,
    ) -> None:
        self._page_responses = list(page_responses or [])
        self._responses_by_folder = {
            k: list(v) for k, v in (responses_by_folder or {}).items()
        }
        self._meta = meta
        self._export_payload = export_payload
        self._media_payload = media_payload
        self._fail_get = fail_get

    def list(
        self, q: str = "", pageToken: object = None, **_: object
    ) -> "_FakeListCall":
        folder = self._extract_folder(q)
        if folder and folder in self._responses_by_folder:
            responses = self._responses_by_folder[folder]
            if pageToken is None:
                # First page
                return _FakeListCall([responses[0]])
            # Subsequent page → take the second entry if present.
            if len(responses) > 1:
                return _FakeListCall([responses[1]])
            return _FakeListCall([])
        if not self._page_responses:
            return _FakeListCall([])
        return _FakeListCall(self._page_responses)

    @staticmethod
    def _extract_folder(q: str) -> str | None:
        # naive parse of `'folder' in parents`
        marker = "'"
        if marker not in q:
            return None
        parts = q.split(marker)
        return parts[1] if len(parts) > 1 else None

    def get(self, **_: object) -> "_FakeGetCall":
        if self._fail_get:
            raise RuntimeError("drive down")
        return _FakeGetCall(self._meta)

    def export(self, **_: object) -> "_FakeExportCall":
        return _FakeExportCall(self._export_payload or b"")

    def get_media(self, **_: object) -> "_FakeMediaCall":
        return _FakeMediaCall(self._media_payload or b"")


class _FakeListCall:
    def __init__(self, responses: list[dict]) -> None:
        self._responses = list(responses)

    def execute(self) -> dict:
        if not self._responses:
            return {"files": []}
        return self._responses.pop(0)


class _FakeGetCall:
    def __init__(self, meta: dict | None) -> None:
        self._meta = meta or {}

    def execute(self) -> dict:
        return self._meta


class _FakeExportCall:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def execute(self) -> bytes:
        return self._payload


class _FakeMediaCall:
    def __init__(self, payload: bytes) -> None:
        self._payload = payload

    def execute(self) -> bytes:
        return self._payload


class _ServiceStub:
    def __init__(self, files_resource: _FakeFilesResource) -> None:
        self._files_resource = files_resource

    def files(self) -> _FakeFilesResource:
        return self._files_resource
