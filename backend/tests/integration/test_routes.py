from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from unittest.mock import ANY, Mock, patch

import pytest
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.testclient import TestClient

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.routes.file_embeddings import create_file_embeddings
from backend.app.api.routes.health import HealthDependencies
from backend.app.api.schemas.file_embeddings import (
    FileEmbeddingItem,
    FileEmbeddingResponse,
)
from backend.app.exceptions import (
    ModelEndpointError,
    ModelNotFoundError,
    QdrantStorageError,
)
from backend.app.file_embeddings.ingestion_service import (
    FileIngestionService,
    FileUpload,
)
from backend.app.file_processing.service import MAX_FILE_SIZE
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.main import create_app
from backend.app.model.description_client import ImageDescriptionClient
from backend.app.model.prompt_model import ImageDescription
from backend.app.security import MAX_REQUEST_SIZE
from backend.app.tag_settings.store import TagSettingsStore

REPO_ROOT = Path(__file__).parents[3]
SMALL_PNG_PATH = REPO_ROOT / "backend" / "tests" / "fixtures" / "small.png"


@dataclass(frozen=True)
class _HealthDependency:
    status: str

    def check_health(self) -> str:
        return self.status


class _BoundedReadFile(BytesIO):
    def __init__(self, content: bytes) -> None:
        super().__init__(content)
        self.read_sizes: list[int] = []

    def read(self, size: int = -1) -> bytes:
        self.read_sizes.append(size)
        if size < 0:
            raise AssertionError("file read must be bounded")
        return super().read(size)


def override_ingestion_service(app: FastAPI, service: Mock) -> None:  # noqa: ARG001
    app.dependency_overrides[get_file_ingestion_service] = lambda: service


@pytest.mark.integration
def test_upload_uses_configured_ingestion_service_without_model_field(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.return_value = FileEmbeddingResponse(
        data=[
            FileEmbeddingItem(
                filename="photo.png",
                content_type="image/png",
                status="success",
            )
        ]
    )
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("photo.png", b"image", "image/png"))],
        )

    assert response.status_code == 200
    uploads = service.process_files.call_args.args[0]
    assert len(uploads) == 1
    assert uploads[0].filename == "photo.png"
    assert uploads[0].file_path == ""
    assert uploads[0].content == b"image"
    assert uploads[0].provider is None
    assert uploads[0].storage_file_id is None
    assert service.process_files.call_args.kwargs == {}


@pytest.mark.integration
def test_uploads_files_in_order_and_returns_public_response(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.return_value = FileEmbeddingResponse(
        data=[
            FileEmbeddingItem(
                filename="first.png",
                content_type="image/png",
                status="success",
                reason=None,
            ),
            FileEmbeddingItem(
                filename="second.png",
                content_type="image/png",
                status="success",
                reason=None,
            ),
        ]
    )
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[
                ("files", ("first.png", b"first image", "image/png")),
                ("files", ("second.png", b"second image", "image/png")),
            ],
        )

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "data": [
            {
                "filename": "first.png",
                "content_type": "image/png",
                "status": "success",
                "reason": None,
            },
            {
                "filename": "second.png",
                "content_type": "image/png",
                "status": "success",
                "reason": None,
            },
        ],
    }
    service.process_files.assert_called_once_with(
        (
            FileUpload("first.png", "image/png", b"first image", "", ANY),
            FileUpload("second.png", "image/png", b"second image", "", ANY),
        ),
    )
    assert "point_id" not in response.json()
    assert "vector" not in response.json()


@pytest.mark.integration
def test_declared_oversized_content_length_returns_payload_too_large(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            headers={"Content-Length": str(MAX_REQUEST_SIZE + 1)},
        )

    assert response.status_code == 413
    service.process_files.assert_not_called()


@pytest.mark.integration
def test_upload_without_files_returns_bad_request(app: FastAPI) -> None:
    service = Mock(spec=FileIngestionService)
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post("/v1/file-embeddings")

    assert response.status_code == 400
    assert "No files provided" in response.json()["detail"]
    service.process_files.assert_not_called()


@pytest.mark.integration
def test_uploading_more_than_ten_files_returns_bad_request(app: FastAPI) -> None:
    service = Mock(spec=FileIngestionService)
    override_ingestion_service(app, service)
    files = [
        ("files", (f"file-{index}.png", b"content", "image/png")) for index in range(11)
    ]

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=files,
        )

    assert response.status_code == 400
    assert "10" in response.json()["detail"]
    service.process_files.assert_not_called()


@pytest.mark.integration
def test_route_closes_all_uploads_before_rejecting_more_than_ten(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    override_ingestion_service(app, service)
    file_handles = [_BoundedReadFile(b"content") for _ in range(11)]
    uploads = [
        UploadFile(file=handle, filename=f"file-{index}.png")
        for index, handle in enumerate(file_handles)
    ]

    with pytest.raises(HTTPException) as raised:
        create_file_embeddings(
            files=uploads,
            file_path=None,
            service=service,
        )

    assert raised.value.status_code == 400
    assert all(handle.closed for handle in file_handles)
    service.process_files.assert_not_called()


@pytest.mark.integration
def test_route_bounds_oversized_upload_read_and_returns_file_error(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    file_handle = _BoundedReadFile(b"x" * (MAX_FILE_SIZE + 1))
    upload = UploadFile(
        file=file_handle,
        filename="oversized.png",
        headers={"content-type": "image/png"},
    )

    response = create_file_embeddings(
        files=[upload],
        file_path=None,
        service=service,
    )

    assert response.data[0].filename == "oversized.png"
    assert response.data[0].status == "failed"
    assert response.data[0].reason == "File exceeds 25 MB limit"
    assert file_handle.read_sizes == [MAX_FILE_SIZE + 1]
    assert file_handle.closed
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
def test_real_service_reports_empty_file_without_embedding_or_storage(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("empty.png", b"", "image/png"))],
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "filename": "empty.png",
            "content_type": "image/png",
            "status": "failed",
            "reason": "Empty file",
        }
    ]
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
def test_real_service_preserves_order_for_oversized_and_unsupported_files(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)
    oversized = b"x" * (25 * 1024 * 1024 + 1)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[
                ("files", ("oversized.png", oversized, "image/png")),
                (
                    "files",
                    ("unsupported.bin", b"unsupported", "application/octet-stream"),
                ),
            ],
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "filename": "oversized.png",
            "content_type": "image/png",
            "status": "failed",
            "reason": "File exceeds 25 MB limit",
        },
        {
            "filename": "unsupported.bin",
            "content_type": "application/octet-stream",
            "status": "failed",
            "reason": "Unsupported file type",
        },
    ]
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
@pytest.mark.parametrize(
    "error_message",
    ["Model endpoint timed out", "Model endpoint rejected input"],
)
def test_real_service_returns_safe_model_error_per_file(
    app: FastAPI,
    error_message: str,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    description_client.describe.return_value = ImageDescription(
        subjects=("square",),
        attributes=("green",),
        actions=("static",),
        setting=("fixture",),
        colors=("green",),
        style=("pixel art",),
        visible_text=(),
    )
    model_client = Mock(spec=ModelClient)
    model_client.embed_text.side_effect = ModelEndpointError(error_message)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.png", SMALL_PNG_PATH.read_bytes(), "image/png"))],
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["status"] == "failed"
    assert response.json()["data"][0]["reason"] == error_message
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
def test_real_service_returns_200_when_all_files_fail_processing(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[
                (
                    "files",
                    (
                        "bad.bin",
                        b"\x1f\x8b\x08\x00",
                        "application/octet-stream",
                    ),
                )
            ],
        )

    assert response.status_code == 200
    assert response.json() == {
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
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
def test_real_service_returns_safe_qdrant_error_per_file(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    description_client.describe.return_value = ImageDescription(
        subjects=("square",),
        attributes=("green",),
        actions=("static",),
        setting=("fixture",),
        colors=("green",),
        style=("pixel art",),
        visible_text=(),
    )
    model_client = Mock(spec=ModelClient)
    model_client.embed_text.return_value = [0.1, 0.2]
    qdrant_store = Mock(spec=QdrantStore)
    qdrant_store.store_embedding.side_effect = QdrantStorageError(
        "Qdrant storage failure"
    )
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.png", SMALL_PNG_PATH.read_bytes(), "image/png"))],
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["status"] == "failed"
    assert response.json()["data"][0]["reason"] == "Qdrant storage failure"
    model_client.embed_text.assert_called_once_with(
        description_client.describe.return_value.to_embedding_text()
    )
    qdrant_store.store_embedding.assert_called_once_with([0.1, 0.2], payload=None)


@pytest.mark.integration
def test_health_is_ok_when_both_models_and_qdrant_are_available(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    dependencies = HealthDependencies(
        description_client=_HealthDependency("ok"),
        model_client=_HealthDependency("ok"),
        qdrant_store=_HealthDependency("ok"),
    )
    app_with_deps = create_app(service=service, health_dependencies=dependencies)

    with TestClient(app_with_deps) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "qdrant": "ok",
        "embedding_model": "ok",
        "description_model": "ok",
        "providers": [],
    }


@pytest.mark.integration
@pytest.mark.parametrize(
    ("description_status", "embedding_status", "qdrant_status"),
    [
        ("unavailable", "ok", "ok"),
        ("ok", "unavailable", "ok"),
        ("ok", "ok", "unavailable"),
        ("unavailable", "unavailable", "unavailable"),
    ],
)
def test_health_is_degraded_when_any_dependency_is_unavailable(
    app: FastAPI,
    description_status: str,
    embedding_status: str,
    qdrant_status: str,
) -> None:
    service = Mock(spec=FileIngestionService)
    dependencies = HealthDependencies(
        description_client=_HealthDependency(description_status),
        model_client=_HealthDependency(embedding_status),
        qdrant_store=_HealthDependency(qdrant_status),
    )
    app_with_deps = create_app(service=service, health_dependencies=dependencies)

    with TestClient(app_with_deps) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "qdrant": qdrant_status,
        "embedding_model": embedding_status,
        "description_model": description_status,
        "providers": [],
    }


@pytest.mark.integration
def test_health_is_ok_without_registered_providers(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    dependencies = HealthDependencies(
        description_client=_HealthDependency("ok"),
        model_client=_HealthDependency("ok"),
        qdrant_store=_HealthDependency("ok"),
    )
    app_with_deps = create_app(service=service, health_dependencies=dependencies)

    with TestClient(app_with_deps) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "qdrant": "ok",
        "embedding_model": "ok",
        "description_model": "ok",
        "providers": [],
    }


@pytest.mark.integration
def test_injected_service_starts_once_on_testclient_lifespan(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)

    with TestClient(create_app(service=service)):
        service.startup.assert_called_once_with()


@pytest.mark.integration
def test_injected_tag_settings_store_starts_on_testclient_lifespan() -> None:
    service = Mock(spec=FileIngestionService)
    tag_settings_store = Mock(spec=TagSettingsStore)
    app = create_app(service=service, tag_settings_store=tag_settings_store)

    with TestClient(app) as client:
        assert client.app.state.tag_settings_store is tag_settings_store
        tag_settings_store.ensure_collection.assert_called_once_with()


@pytest.mark.integration
def test_default_tag_settings_store_uses_application_settings(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tag_settings_store = Mock(spec=TagSettingsStore)
    settings = Mock()
    settings.DESCRIPTION_ENDPOINT_URL = "https://description.example"
    settings.DESCRIPTION_ENDPOINT_API_KEY = "description-key"
    settings.DESCRIPTION_MODEL = "description-model"
    settings.MODEL_REQUEST_TIMEOUT = 30
    settings.QDRANT_COLLECTION = "assets"
    settings.QDRANT_VECTOR_SIZE = 2
    with (
        patch("backend.app.main.Settings", return_value=settings),
        patch(
            "backend.app.main.TagSettingsStore.from_settings",
            return_value=tag_settings_store,
        ) as factory,
        patch("backend.app.main.InstructorImageDescriptionClient"),
        patch("backend.app.main.OpenAICompatibleModelClient"),
        patch("backend.app.main.QdrantEmbeddingStore"),
        patch("backend.app.main.build_provider_registry", return_value=Mock()),
    ):
        with TestClient(create_app()):
            pass

    factory.assert_called_once_with(settings)
    tag_settings_store.ensure_collection.assert_called_once_with()


@pytest.mark.integration
def test_qdrant_startup_error_surfaces_on_testclient_entry() -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    qdrant_store = Mock(spec=QdrantStore)
    qdrant_store.ensure_collection.side_effect = QdrantStorageError(
        "Qdrant storage failure"
    )
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app = create_app(service=service)

    with pytest.raises(QdrantStorageError, match="Qdrant storage failure"):
        with TestClient(app):
            pass


@pytest.mark.integration
def test_file_upload_returns_503_when_model_not_found(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.side_effect = ModelNotFoundError()
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.png", b"content", "image/png"))],
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Model not found"}
