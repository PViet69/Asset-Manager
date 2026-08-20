from datetime import datetime, timezone
from logging import ERROR
from unittest.mock import Mock, patch

import pytest

from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.api.schemas.vector_search import VectorSearchResponse
from backend.app.config import Settings
from backend.app.exceptions import (
    FileProcessingError,
    ModelEndpointError,
    QdrantStorageError,
    SettingsError,
)
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.file_processing.types import ProcessedInput
from backend.app.integrations.qdrant_store import SearchHit
from backend.app.model.prompt_model import ImageDescription


def make_description() -> ImageDescription:
    return ImageDescription(
        subjects=("woman",),
        attributes=("green eyes",),
        actions=("looking at camera",),
        setting=("outdoors",),
        colors=("green",),
        style=("portrait photography",),
        visible_text=(),
    )


def make_service() -> tuple[FileIngestionService, Mock, Mock, Mock]:
    description_client = Mock()
    model_client = Mock()
    model_client.model_name = "embedding-model"
    qdrant_store = Mock()
    service = FileIngestionService(
        description_client,
        model_client,
        qdrant_store,
    )
    return service, description_client, model_client, qdrant_store


TEST_MODIFIED_TIME = datetime(2026, 8, 1, tzinfo=timezone.utc)


def make_upload(
    filename: str,
    content_type: str,
    content: bytes,
    file_path: str,
    drive_id: str = "drive-id-1",
    modified_time: datetime = TEST_MODIFIED_TIME,
) -> FileUpload:
    return FileUpload(
        filename=filename,
        content_type=content_type,
        content=content,
        file_path=file_path,
        drive_id=drive_id,
        modified_time=modified_time,
    )


@pytest.mark.unit
def test_file_upload_is_immutable() -> None:
    upload = make_upload("note.txt", "text/plain", b"hello", "note.txt")

    with pytest.raises((AttributeError, TypeError)):
        upload.filename = "changed.txt"

    assert upload.filename == "note.txt"
    assert upload.content_type == "text/plain"
    assert upload.content == b"hello"


@pytest.mark.unit
def test_image_description_text_is_embedded_and_only_vector_is_stored() -> None:
    service, description_client, model_client, qdrant_store = make_service()
    description = make_description()
    description_client.describe.return_value = description
    model_client.embed_text.return_value = [0.3]
    image_bytes = b"validated-image-bytes"
    upload = make_upload("photo.png", "image/png", image_bytes, "photos/photo.png")

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        return_value=ProcessedInput("image", image_bytes),
    ):
        response = service.process_files((upload,))

    description_client.describe.assert_called_once_with(image_bytes)
    model_client.embed_text.assert_called_once_with(description.to_embedding_text())
    qdrant_store.store_embedding.assert_called_once_with(
        [0.3],
        payload={
            "filename": "photo.png",
            "file_path": "photos/photo.png",
            "file_type": "image/png",
            "content": description.to_embedding_text(),
            "drive_id": "drive-id-1",
            "modified_time": TEST_MODIFIED_TIME.isoformat(),
        },
    )
    assert response.data[0].model_dump() == {
        "filename": "photo.png",
        "content_type": "image/png",
        "status": "success",
        "reason": None,
    }


@pytest.mark.unit
def test_text_bypasses_description_and_embeds_extracted_text() -> None:
    service, description_client, model_client, qdrant_store = make_service()
    model_client.embed_text.return_value = [0.1, 0.2]
    upload = make_upload("note.txt", "text/plain", b"source-bytes", "note.txt")

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        return_value=ProcessedInput("text", "hello"),
    ) as process_file:
        response = service.process_files((upload,))

    process_file.assert_called_once_with(b"source-bytes", "note.txt", "text/plain")
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_called_once_with("hello")
    qdrant_store.store_embedding.assert_called_once_with([0.1, 0.2], payload=None)
    assert response.data[0].status == "success"


@pytest.mark.unit
def test_embed_text_uses_configured_embedding_client_without_storage() -> None:
    service, description_client, model_client, qdrant_store = make_service()
    model_client.embed_text.return_value = [0.7]

    assert service.embed_text("query") == [0.7]
    assert service.embedding_model == "embedding-model"
    model_client.embed_text.assert_called_once_with("query")
    description_client.describe.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.unit
def test_description_error_is_safe_and_later_files_continue_in_order() -> None:
    service, description_client, model_client, qdrant_store = make_service()
    description_client.describe.side_effect = ModelEndpointError(
        "Model endpoint failed to describe image"
    )
    model_client.embed_text.return_value = [0.4]
    uploads = (
        make_upload("bad.png", "image/png", b"image", "bad.png"),
        make_upload("good.txt", "text/plain", b"text", "good.txt"),
    )

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        side_effect=(
            ProcessedInput("image", b"image"),
            ProcessedInput("text", "good"),
        ),
    ):
        response = service.process_files(uploads)

    assert [item.filename for item in response.data] == ["bad.png", "good.txt"]
    assert [(item.status, item.reason) for item in response.data] == [
        ("failed", "Model endpoint failed to describe image"),
        ("success", None),
    ]
    model_client.embed_text.assert_called_once_with("good")
    qdrant_store.store_embedding.assert_called_once_with([0.4], payload=None)


@pytest.mark.unit
def test_real_processing_returns_normal_response_when_all_files_fail() -> None:
    service, _, _, _ = make_service()

    response = service.process_files(
        (
            make_upload(
                "bad.bin",
                "application/octet-stream",
                b"\x1f\x8b\x08\x00",
                "bad.bin",
            ),
        ),
    )

    assert isinstance(response, FileEmbeddingResponse)
    assert response.model_dump() == {
        "object": "list",
        "data": [
            {
                "filename": "bad.bin",
                "content_type": "application/octet-stream",
                "status": "failed",
                "reason": "Unsupported file type",
            }
        ],
    }


@pytest.mark.unit
def test_file_processing_error_returns_safe_message() -> None:
    service = FileIngestionService(Mock(), Mock(), Mock())

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        side_effect=FileProcessingError("Unsupported file type"),
    ):
        response = service.process_files(
            (make_upload("bad.bin", "application/octet-stream", b"bytes", "bad.bin"),),
        )

    assert response.data[0].status == "failed"
    assert response.data[0].reason == "Unsupported file type"


@pytest.mark.unit
def test_qdrant_storage_error_returns_safe_message() -> None:
    _, _, model_client, qdrant_store = make_service()
    model_client.embed_text.return_value = [0.1]
    qdrant_store.store_embedding.side_effect = QdrantStorageError(
        "Qdrant storage failure"
    )
    service = FileIngestionService(Mock(), model_client, qdrant_store)

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        return_value=ProcessedInput("text", "hello"),
    ):
        response = service.process_files(
            (make_upload("note.txt", "text/plain", b"bytes", "note.txt"),),
        )

    assert response.data[0].status == "failed"
    assert response.data[0].reason == "Qdrant storage failure"


@pytest.mark.unit
def test_unexpected_error_logs_context_without_sensitive_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    service, _, _, _ = make_service()
    file_content = b"secret file content"
    filename = "private\nforged.txt"

    caplog.set_level(ERROR)
    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        side_effect=RuntimeError("secret provider response"),
    ):
        response = service.process_files(
            (make_upload(filename, "text/plain", file_content, filename),),
        )

    assert response.data[0].reason == "Processing failed"
    message = caplog.records[0].getMessage()
    assert filename not in message
    assert repr(filename) in message
    assert "RuntimeError" in message
    assert "secret file content" not in message
    assert "secret provider response" not in message


@pytest.mark.unit
def test_startup_ensures_collection_once() -> None:
    _, _, _, qdrant_store = make_service()
    service = FileIngestionService(Mock(), Mock(), qdrant_store)

    service.startup()

    qdrant_store.ensure_collection.assert_called_once_with()


@pytest.mark.unit
def test_startup_surfaces_qdrant_storage_error() -> None:
    qdrant_store = Mock()
    qdrant_store.ensure_collection.side_effect = QdrantStorageError(
        "Qdrant storage failure"
    )
    service = FileIngestionService(Mock(), Mock(), qdrant_store)

    with pytest.raises(QdrantStorageError, match="Qdrant storage failure"):
        service.startup()

    qdrant_store.ensure_collection.assert_called_once_with()


def make_settings(search_threshold: float | None = 0.2) -> Settings:
    return Settings(
        _env_file=None,
        MODEL_ENDPOINT_URL="https://model.example",
        DESCRIPTION_MODEL="vision-model",
        DESCRIPTION_ENDPOINT_URL="https://vision.example",
        DESCRIPTION_ENDPOINT_API_KEY="vision-key",
        EMBEDDING_MODEL="embedding-model",
        QDRANT_URL="https://qdrant.example",
        QDRANT_VECTOR_SIZE=2,
        SEARCH_THRESHOLD=search_threshold,
    )


@pytest.mark.unit
def test_text_ingestion_stores_vector_without_payload() -> None:
    service, _, model_client, qdrant_store = make_service()
    model_client.embed_text.return_value = [0.5]
    upload = make_upload("note.txt", "text/plain", b"hello world", "note.txt")

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        return_value=ProcessedInput("text", "hello world"),
    ):
        service.process_files((upload,))

    qdrant_store.store_embedding.assert_called_once_with([0.5], payload=None)


@pytest.mark.unit
def test_search_populates_source_url_when_drive_id_present() -> None:
    service, _, model_client, qdrant_store = make_service()
    service_with_settings = FileIngestionService(
        service._description_client,
        model_client,
        qdrant_store,
        settings=make_settings(0.2),
    )
    model_client.embed_text.return_value = [0.7]
    qdrant_store.search.return_value = [
        SearchHit(
            point_id="point-1",
            score=0.9,
            payload={
                "filename": "photo.png",
                "file_path": "photo.png",
                "file_type": "image/png",
                "content": "description text",
                "drive_id": "abc123",
            },
        )
    ]

    response = service_with_settings.search("red car", limit=5)

    assert response.data[0].source_url == (
        "https://drive.google.com/file/d/abc123/view"
    )


@pytest.mark.unit
def test_search_embeds_query_and_maps_hits() -> None:
    service, _, model_client, qdrant_store = make_service()
    service_with_settings = FileIngestionService(
        service._description_client,
        model_client,
        qdrant_store,
        settings=make_settings(0.2),
    )
    model_client.embed_text.return_value = [0.7]
    qdrant_store.search.return_value = [
        SearchHit(
            point_id="point-1",
            score=0.9,
            payload={
                "filename": "photo.png",
                "file_path": "photo.png",
                "file_type": "image/png",
                "content": "description text",
            },
        )
    ]

    response = service_with_settings.search("red car", limit=5)

    model_client.embed_text.assert_called_once_with("red car")
    qdrant_store.search.assert_called_once_with([0.7], limit=5, score_threshold=0.2)
    assert isinstance(response, VectorSearchResponse)
    assert response.model_dump() == {
        "object": "list",
        "data": [
            {
                "point_id": "point-1",
                "score": 0.9,
                "filename": "photo.png",
                "file_path": "photo.png",
                "file_type": "image/png",
                "content": "description text",
                "source_url": None,
            }
        ],
    }


@pytest.mark.unit
def test_search_without_configured_threshold_raises_settings_error() -> None:
    service, _, model_client, qdrant_store = make_service()

    with pytest.raises(SettingsError) as exc_info:
        service.search("red car", limit=5)

    assert exc_info.value.safe_message == "Search is not configured"
    model_client.embed_text.assert_not_called()
    qdrant_store.search.assert_not_called()


@pytest.mark.unit
def test_search_drops_hits_without_complete_payload() -> None:
    _, description_client, model_client, qdrant_store = make_service()
    service = FileIngestionService(
        description_client,
        model_client,
        qdrant_store,
        settings=make_settings(0.2),
    )
    model_client.embed_text.return_value = [0.7]
    qdrant_store.search.return_value = [
        SearchHit(point_id="legacy-1", score=0.6, payload={}),
        SearchHit(point_id="partial-1", score=0.5, payload={"filename": "a.png"}),
        SearchHit(
            point_id="full-1",
            score=0.4,
            payload={
                "filename": "photo.png",
                "file_path": "photo.png",
                "file_type": "image/png",
                "content": "description text",
            },
        ),
    ]

    response = service.search("red car", limit=5)

    assert [item.point_id for item in response.data] == ["full-1"]
    assert response.data[0].model_dump() == {
        "point_id": "full-1",
        "score": 0.4,
        "filename": "photo.png",
        "file_path": "photo.png",
        "file_type": "image/png",
        "content": "description text",
        "source_url": None,
    }
