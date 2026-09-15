"""Deterministic end-to-end ingestion tests against in-memory Qdrant."""

from pathlib import Path
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient
from qdrant_client import QdrantClient

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import QdrantEmbeddingStore
from backend.app.main import create_app
from backend.app.model.description_client import ImageDescriptionClient
from backend.app.model.prompt_model import ImageDescription

REPO_ROOT = Path(__file__).parents[3]
SMALL_PNG_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "small.png"


def _normalize(vector: list[float]) -> list[float]:
    norm = sum(component * component for component in vector) ** 0.5
    if norm == 0:
        return vector
    return [component / norm for component in vector]


def _description() -> ImageDescription:
    return ImageDescription(
        subjects=("square",),
        attributes=("green",),
        actions=("static",),
        setting=("test fixture",),
        colors=("green",),
        style=("pixel art",),
        visible_text=(),
    )


@pytest.mark.integration
def test_end_to_end_image_pipeline_embeds_description_and_stores_vector() -> None:
    description_client = Mock(spec=ImageDescriptionClient)
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
        description_client=description_client,
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
def test_end_to_end_rejects_text_file_before_embedding() -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantEmbeddingStore)
    service = FileIngestionService(
        description_client=description_client,
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
