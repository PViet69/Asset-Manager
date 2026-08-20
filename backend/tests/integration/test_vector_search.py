"""Integration tests for the vector search route."""

from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.schemas.vector_search import (
    VectorSearchItem,
    VectorSearchResponse,
)
from backend.app.exceptions import (
    ModelEndpointError,
    ModelNotFoundError,
    QdrantStorageError,
    SettingsError,
)
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.main import create_app


def override_ingestion_service(app: FastAPI, service: Mock) -> None:
    app.dependency_overrides[get_file_ingestion_service] = lambda: service


def make_search_service() -> Mock:
    service = Mock(spec=FileIngestionService)
    service.embedding_model = "embedding-model"
    return service


@pytest.mark.integration
def test_search_returns_hits(app: FastAPI) -> None:
    service = make_search_service()
    service.search.return_value = VectorSearchResponse(
        data=[
            VectorSearchItem(
                point_id="point-1",
                score=0.9,
                filename="photo.png",
                file_path="photos/photo.png",
                file_type="image/png",
                content="description text",
            )
        ]
    )
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "data": [
            {
                "point_id": "point-1",
                "score": 0.9,
                "filename": "photo.png",
                "file_path": "photos/photo.png",
                "file_type": "image/png",
                "content": "description text",
                "source_url": None,
            }
        ],
    }
    service.search.assert_called_once_with("red car", limit=10)


@pytest.mark.integration
def test_search_passes_custom_limit(app: FastAPI) -> None:
    service = make_search_service()
    service.search.return_value = VectorSearchResponse(data=[])
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car", "limit": 3})

    assert response.status_code == 200
    assert response.json() == {"object": "list", "data": []}
    service.search.assert_called_once_with("red car", limit=3)


@pytest.mark.integration
@pytest.mark.parametrize("limit", [0, 101])
def test_search_rejects_limit_out_of_range(app: FastAPI, limit: int) -> None:
    service = make_search_service()
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car", "limit": limit})

    assert response.status_code == 422
    service.search.assert_not_called()


@pytest.mark.integration
def test_search_rejects_blank_query(app: FastAPI) -> None:
    service = make_search_service()
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "   "})

    assert response.status_code == 422
    service.search.assert_not_called()


@pytest.mark.integration
def test_search_returns_503_when_threshold_not_configured(app: FastAPI) -> None:
    service = make_search_service()
    service.search.side_effect = SettingsError("Search is not configured")
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Search is not configured"


@pytest.mark.integration
def test_search_returns_502_when_model_endpoint_fails(app: FastAPI) -> None:
    service = make_search_service()
    service.search.side_effect = ModelEndpointError("Model request failed")
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 502
    assert response.json()["detail"] == "Model request failed"


@pytest.mark.integration
def test_search_returns_503_when_model_not_found(app: FastAPI) -> None:
    service = make_search_service()
    service.search.side_effect = ModelNotFoundError()
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 503
    assert response.json()["detail"] == "Model not found"


@pytest.mark.integration
def test_search_returns_502_when_qdrant_fails(app: FastAPI) -> None:
    service = make_search_service()
    service.search.side_effect = QdrantStorageError("Qdrant storage failure")
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 502
    assert response.json()["detail"] == "Qdrant storage failure"


@pytest.mark.integration
def test_search_requires_bearer_token_when_upload_key_configured() -> None:
    service = make_search_service()
    app = create_app(service=service, upload_api_key="secret-key")

    with TestClient(app) as client:
        response = client.post("/v1/search", json={"query": "red car"})

    assert response.status_code == 401
    service.search.assert_not_called()
