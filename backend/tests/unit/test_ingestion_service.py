from datetime import datetime, timezone
from logging import ERROR
from unittest.mock import ANY, Mock, patch

import pytest

from backend.app.api.schemas.file_embeddings import FileEmbeddingResponse
from backend.app.api.schemas.vector_search import VectorSearchResponse
from backend.app.config import Settings
from backend.app.exceptions import (
    FileProcessingError,
    ModelEndpointError,
    ModelNotFoundError,
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
from backend.app.storage import StorageProvider


def make_description() -> ImageDescription:
    return ImageDescription(
        subjects=("human",),
        attributes=("green eyes",),
        actions=("looking",),
        setting=("outdoor",),
        colors=("green",),
        style=("photo",),
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
    modified_time: datetime = TEST_MODIFIED_TIME,
) -> FileUpload:
    return FileUpload(
        filename=filename,
        content_type=content_type,
        content=content,
        file_path=file_path,
        modified_time=modified_time,
    )


def make_storage_upload(
    filename: str,
    content_type: str,
    content: bytes,
    file_path: str,
    storage_file_id: str = "drive-id-1",
    modified_time: datetime = TEST_MODIFIED_TIME,
) -> FileUpload:
    return FileUpload(
        filename=filename,
        content_type=content_type,
        content=content,
        file_path=file_path,
        modified_time=modified_time,
        provider=StorageProvider.GOOGLE_DRIVE,
        storage_file_id=storage_file_id,
        source_url=f"https://drive.google.com/file/d/{storage_file_id}/view",
    )


def make_video_description(
    *,
    subjects: tuple[str, ...],
    actions: tuple[str, ...],
    setting: tuple[str, ...],
    colors: tuple[str, ...],
    style: tuple[str, ...],
    visible_text: tuple[str, ...] = (),
    angles: tuple[str, ...] = (),
) -> ImageDescription:
    return ImageDescription(
        subjects=subjects,
        actions=actions,
        setting=setting,
        colors=colors,
        style=style,
        visible_text=visible_text,
        angles=angles,
    )


@pytest.mark.unit
def test_merges_image_descriptions_with_ordered_deduplication() -> None:
    first = make_video_description(
        subjects=("human", "electronics"),
        actions=("speaking",),
        setting=("studio",),
        colors=("blue",),
        style=("photo",),
        visible_text=("Asset Tracker",),
        angles=("frontal",),
    )
    second = make_video_description(
        subjects=("electronics", "product", "human"),
        actions=("working",),
        setting=("studio", "office"),
        colors=("blue", "white"),
        style=("photo", "real life"),
        visible_text=("asset tracker",),
        angles=("side",),
    )

    assert merge_image_descriptions((first, second)) == make_video_description(
        subjects=("human", "electronics", "product"),
        actions=("speaking", "working"),
        setting=("studio", "office"),
        colors=("blue", "white"),
        style=("photo", "real life"),
        visible_text=("Asset Tracker",),
        angles=("frontal", "side"),
    )


@pytest.mark.unit
def test_file_upload_is_immutable() -> None:
    upload = make_upload("photo.png", "image/png", b"image", "photo.png")

    with pytest.raises((AttributeError, TypeError)):
        upload.filename = "changed.png"

    assert upload.filename == "photo.png"
    assert upload.content_type == "image/png"
    assert upload.content == b"image"


@pytest.mark.unit
@pytest.mark.parametrize(
    ("provider", "storage_file_id", "source_url"),
    [
        (StorageProvider.DROPBOX, None, "https://www.dropbox.com/home/photo.png"),
        (None, "id:example", "https://drive.google.com/file/d/id:example/view"),
        (StorageProvider.DROPBOX, "id:example", None),
    ],
)
def test_file_upload_requires_complete_provider_source_identity(
    provider: str | None,
    storage_file_id: str | None,
    source_url: str | None,
) -> None:
    with pytest.raises(ValueError, match="provider-backed files"):
        FileUpload(
            filename="photo.png",
            content_type="image/png",
            content=b"image",
            file_path="photo.png",
            modified_time=TEST_MODIFIED_TIME,
            provider=provider,
            storage_file_id=storage_file_id,
            source_url=source_url,
        )


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
def test_description_error_is_safe_for_each_image_and_later_images_continue_in_order() -> (
    None
):
    service, description_client, model_client, qdrant_store = make_service()
    description_client.describe.side_effect = (
        ModelEndpointError("Model endpoint failed to describe image"),
        make_description(),
    )
    model_client.embed_text.return_value = [0.4]
    uploads = (
        make_upload("bad.png", "image/png", b"bad-image", "bad.png"),
        make_upload("good.png", "image/png", b"good-image", "good.png"),
    )

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        side_effect=(
            ProcessedInput("image", b"bad-image"),
            ProcessedInput("image", b"good-image"),
        ),
    ):
        response = service.process_files(uploads)

    assert [item.filename for item in response.data] == ["bad.png", "good.png"]
    assert [(item.status, item.reason) for item in response.data] == [
        ("failed", "Model endpoint failed to describe image"),
        ("success", None),
    ]
    model_client.embed_text.assert_called_once_with(
        make_description().to_embedding_text()
    )
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
    _, description_client, model_client, qdrant_store = make_service()
    description_client.describe.return_value = make_description()
    model_client.embed_text.return_value = [0.1]
    qdrant_store.store_embedding.side_effect = QdrantStorageError(
        "Qdrant storage failure"
    )
    service = FileIngestionService(description_client, model_client, qdrant_store)

    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        return_value=ProcessedInput("image", b"image"),
    ):
        response = service.process_files(
            (make_upload("photo.png", "image/png", b"image", "photo.png"),),
        )

    assert response.data[0].status == "failed"
    assert response.data[0].reason == "Qdrant storage failure"


@pytest.mark.unit
def test_unexpected_error_logs_context_without_sensitive_content(
    caplog: pytest.LogCaptureFixture,
) -> None:
    service, _, _, _ = make_service()
    file_content = b"secret file content"
    filename = "private\nforged.png"

    caplog.set_level(ERROR)
    with patch(
        "backend.app.file_embeddings.ingestion_service.process_file",
        side_effect=RuntimeError("secret provider response"),
    ):
        response = service.process_files(
            (make_upload(filename, "image/png", file_content, filename),),
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
def test_find_indexed_thumbnail_source_requires_exact_stored_identity() -> None:
    service, _, _, qdrant_store = make_service()
    qdrant_store.find_by_storage_key.return_value = [
        SearchHit(
            point_id="point-1",
            score=1.0,
            payload={
                "provider": StorageProvider.DROPBOX,
                "storage_file_id": "id:photo",
                "file_type": "image/png",
            },
        )
    ]

    source = service.find_indexed_thumbnail_source(StorageProvider.DROPBOX, "id:photo")

    assert source is not None
    assert source.provider == StorageProvider.DROPBOX
    assert source.storage_file_id == "id:photo"
    assert source.file_type == "image/png"
    qdrant_store.find_by_storage_key.assert_called_once_with(
        StorageProvider.DROPBOX, "id:photo"
    )


@pytest.mark.unit
@pytest.mark.parametrize(
    ("file_type", "provider", "storage_file_id", "thumbnail_url"),
    [
        (
            "image/png",
            StorageProvider.DROPBOX,
            "id:one",
            f"/v1/storage/{StorageProvider.DROPBOX}/id:one/thumbnail",
        ),
        (
            "image/jpeg",
            StorageProvider.GOOGLE_DRIVE,
            "drive-1",
            f"/v1/storage/{StorageProvider.GOOGLE_DRIVE}/drive-1/thumbnail",
        ),
        ("image/webp", None, None, None),
    ],
)
def test_search_thumbnail_url_requires_image_type_and_complete_source_identity(
    file_type: str,
    provider: str | None,
    storage_file_id: str | None,
    thumbnail_url: str | None,
) -> None:
    item = FileIngestionService._to_search_item(
        SearchHit(
            point_id="point-1",
            score=0.9,
            payload={
                "filename": "asset",
                "file_path": "asset",
                "file_type": file_type,
                "content": "description",
                "provider": provider,
                "storage_file_id": storage_file_id,
            },
        )
    )

    assert item.thumbnail_url == thumbnail_url


@pytest.mark.unit
def test_search_returns_stored_source_metadata() -> None:
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
                "provider": StorageProvider.DROPBOX,
                "storage_file_id": "id:abc123",
                "source_url": "https://www.dropbox.com/home/team/photo.png",
            },
        )
    ]

    response = service_with_settings.search("red car", limit=5)

    assert response.data[0].source_url == "https://www.dropbox.com/home/team/photo.png"
    assert response.data[0].provider == StorageProvider.DROPBOX
    assert response.data[0].storage_file_id == "id:abc123"


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

    model_client.check_health.assert_called_once_with()
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
                "provider": None,
                "storage_file_id": None,
                "thumbnail_url": None,
                "modified_time": None,
            }
        ],
    }


@pytest.mark.unit
def test_semantic_search_skips_embedding_when_model_is_unavailable() -> None:
    service, _, model_client, qdrant_store = make_service()
    service_with_settings = FileIngestionService(
        service._description_client,
        model_client,
        qdrant_store,
        settings=make_settings(0.2),
    )
    model_client.check_health.return_value = "unavailable"

    with pytest.raises(ModelNotFoundError, match="Model not found"):
        service_with_settings.search("red car", limit=5)

    model_client.check_health.assert_called_once_with()
    model_client.embed_text.assert_not_called()
    qdrant_store.search.assert_not_called()


@pytest.mark.unit
def test_semantic_search_passes_tags_to_store_before_scoring() -> None:
    service, _, model_client, qdrant_store = make_service()
    service_with_settings = FileIngestionService(
        service._description_client,
        model_client,
        qdrant_store,
        settings=make_settings(0.2),
    )
    model_client.embed_text.return_value = [0.7]
    qdrant_store.search.return_value = []

    service_with_settings.search(
        "red car", limit=5, tags=["subject:car", "color:red"]
    )

    qdrant_store.search.assert_called_once_with(
        [0.7],
        limit=5,
        score_threshold=0.2,
        tags=["subject:car", "color:red"],
    )


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
        "provider": None,
        "storage_file_id": None,
        "thumbnail_url": None,
        "modified_time": None,
    }
