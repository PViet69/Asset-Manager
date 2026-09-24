"""Deterministic end-to-end ingestion tests against in-memory Qdrant."""

from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import (
    QdrantEmbeddingStore,
    stable_point_id,
)
from backend.app.main import create_app
from backend.app.model.description_client import AssetDescriptionClient
from backend.app.model.prompt_model import ImageDescription
from backend.app.model.video_description_client import VideoModelClient
from backend.app.storage import StorageProvider

REPO_ROOT = Path(__file__).parents[3]
SMALL_PNG_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "small.png"


def _normalize(vector: list[float]) -> list[float]:
    norm = sum(component * component for component in vector) ** 0.5
    if norm == 0:
        return vector
    return [component / norm for component in vector]


def _description() -> ImageDescription:
    return ImageDescription(
        subjects=("object",),
        attributes=("green",),
        actions=(),
        setting=("indoor",),
        colors=("green",),
        style=("illustration",),
        visible_text=(),
    )


@pytest.mark.integration
def test_end_to_end_image_pipeline_embeds_description_and_stores_vector() -> None:
    description_client = Mock(spec=AssetDescriptionClient)
    description_client.describe.return_value = _description()
    description_client.check_health.return_value = "ok"

    model_client = Mock(spec=ModelClient)
    model_client.model_name = "deterministic-embedding"
    model_client.check_health.return_value = "ok"

    expected_text = _description().to_embedding_text()
    model_client.embed_text.return_value = [0.11, 0.22, 0.33]

    qdrant_client = QdrantClient(":memory:")
    qdrant_store = QdrantEmbeddingStore.from_client(
        qdrant_client, vector_size=3, collection="e2e"
    )

    service = FileIngestionService(
        asset_description_client=description_client,
        model_client=model_client,
        qdrant_store=qdrant_store,
    )
    service.startup()

    app = create_app(service=service)
    app.dependency_overrides[get_file_ingestion_service] = lambda: service

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[
                (
                    "files",
                    (
                        "small.png",
                        SMALL_PNG_PATH.read_bytes(),
                        "image/png",
                    ),
                )
            ],
            data={"file_path": ["small.png"]},
        )

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "data": [
            {
                "filename": "small.png",
                "content_type": "image/png",
                "status": "success",
                "reason": None,
            }
        ],
    }

    description_client.describe.assert_called_once()
    model_client.embed_text.assert_called_once_with(expected_text)

    stored = qdrant_client.scroll(collection_name="e2e", limit=10, with_vectors=True)
    points, _ = stored
    assert len(points) == 1
    assert _normalize(points[0].vector) == pytest.approx(
        _normalize([0.11, 0.22, 0.33]), rel=1e-3
    )
    assert points[0].payload == {}


@pytest.mark.integration
def test_provider_video_pipeline_stores_one_stable_qdrant_point() -> None:
    asset_description_client = Mock(spec=AssetDescriptionClient)
    video_model_client = Mock(spec=VideoModelClient)
    video_model_client.describe.return_value = _description()
    model_client = Mock(spec=ModelClient)
    model_client.embed_text.return_value = [0.11, 0.22, 0.33]
    qdrant_client = QdrantClient(":memory:")
    qdrant_store = QdrantEmbeddingStore.from_client(
        qdrant_client, vector_size=3, collection="provider-video"
    )
    service = FileIngestionService(
        asset_description_client=asset_description_client,
        model_client=model_client,
        qdrant_store=qdrant_store,
        video_model_client=video_model_client,
    )
    service.startup()
    modified_time = datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    upload = FileUpload(
        filename="launch.mp4",
        content_type="video/mp4",
        content=b"video bytes",
        file_path="campaigns/launch.mp4",
        modified_time=modified_time,
        provider=StorageProvider.GOOGLE_DRIVE,
        storage_file_id="drive-video-1",
        source_url="https://drive.google.com/file/d/drive-video-1/view",
    )

    response = service.process_files((upload,))

    expected_content = _description().to_embedding_text()
    assert response.data[0].status == "success"
    asset_description_client.describe.assert_not_called()
    video_model_client.describe.assert_called_once_with(b"video bytes", "video/mp4")
    model_client.embed_text.assert_called_once_with(expected_content)
    points, _ = qdrant_client.scroll(
        collection_name="provider-video", limit=10, with_vectors=True
    )
    assert len(points) == 1
    assert str(points[0].id) == stable_point_id(
        StorageProvider.GOOGLE_DRIVE, "drive-video-1"
    )
    assert points[0].payload == {
        "filename": "launch.mp4",
        "file_path": "campaigns/launch.mp4",
        "file_type": "video/mp4",
        "content": expected_content,
        "tags": [
            "subject:object",
            "setting:indoor",
            "color:green",
            "style:illustration",
        ],
        "modified_time": "2026-09-24T12:00:00+00:00",
        "provider": StorageProvider.GOOGLE_DRIVE,
        "storage_file_id": "drive-video-1",
        "source_url": "https://drive.google.com/file/d/drive-video-1/view",
    }


@pytest.mark.integration
def test_end_to_end_rejects_text_file_before_embedding() -> None:
    description_client = Mock(spec=AssetDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantEmbeddingStore)
    service = FileIngestionService(
        asset_description_client=description_client,
        model_client=model_client,
        qdrant_store=qdrant_store,
    )
    app = create_app(service=service)
    app.dependency_overrides[get_file_ingestion_service] = lambda: service

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("note.txt", b"green eyes", "text/plain"))],
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "filename": "note.txt",
            "content_type": "text/plain",
            "status": "failed",
            "reason": "Unsupported file type",
        }
    ]
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()
