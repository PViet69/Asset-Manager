from dataclasses import dataclass
from inspect import iscoroutinefunction
from io import BytesIO
from unittest.mock import ANY, Mock

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
from backend.app.security import MAX_REQUEST_SIZE


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


def _drive_id_fields(file_count: int) -> dict[str, list[str]]:
    """Build repeating drive_id form fields, one per uploaded file."""
    return {"drive_id": [f"drive-{i}" for i in range(file_count)]}


@pytest.mark.integration
def test_create_file_embeddings_is_sync_function() -> None:
    """Route handler must be synchronous for sync SDK/Qdrant operations."""
    assert iscoroutinefunction(create_file_embeddings) is False


@pytest.mark.integration
def test_upload_uses_configured_ingestion_service_without_model_field(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.return_value = FileEmbeddingResponse(
        data=[
            FileEmbeddingItem(
                filename="note.txt",
                content_type="text/plain",
                status="success",
            )
        ]
    )
    override_ingestion_service(app, service)

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("note.txt", b"hello", "text/plain"))],
            data=_drive_id_fields(1),
        )

    assert response.status_code == 200
    uploads = service.process_files.call_args.args[0]
    assert len(uploads) == 1
    assert uploads[0].filename == "note.txt"
    assert uploads[0].file_path == ""
    assert uploads[0].content == b"hello"
    assert uploads[0].drive_id == "drive-0"
    assert service.process_files.call_args.kwargs == {}


@pytest.mark.integration
def test_uploads_files_in_order_and_returns_public_response(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.return_value = FileEmbeddingResponse(
        data=[
            FileEmbeddingItem(
                filename="first.txt",
                content_type="text/plain",
                status="success",
                reason=None,
            ),
            FileEmbeddingItem(
                filename="second.txt",
                content_type="text/plain",
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
                ("files", ("first.txt", b"first content", "text/plain")),
                ("files", ("second.txt", b"second content", "text/plain")),
            ],
            data=_drive_id_fields(2),
        )

    assert response.status_code == 200
    assert response.json() == {
        "object": "list",
        "data": [
            {
                "filename": "first.txt",
                "content_type": "text/plain",
                "status": "success",
                "reason": None,
            },
            {
                "filename": "second.txt",
                "content_type": "text/plain",
                "status": "success",
                "reason": None,
            },
        ],
    }
    service.process_files.assert_called_once_with(
        (
            FileUpload("first.txt", "text/plain", b"first content", "", "drive-0", ANY),
            FileUpload(
                "second.txt", "text/plain", b"second content", "", "drive-1", ANY
            ),
        ),
    )
    assert "point_id" not in response.json()
    assert "vector" not in response.json()


@pytest.mark.integration
def test_openapi_has_no_request_level_model_fields(app: FastAPI) -> None:
    schema = app.openapi()
    upload_parameters = schema["components"]["schemas"][
        "Body_create_file_embeddings_v1_file_embeddings_post"
    ]["properties"]

    assert set(upload_parameters) == {"files", "file_path", "drive_id", "modified_time"}


@pytest.mark.integration
@pytest.mark.parametrize(
    "headers",
    [{}, {"Authorization": "Bearer wrong"}],
)
def test_upload_requires_configured_api_key(
    headers: dict[str, str],
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    override_ingestion_service(app, service)
    app_with_key = create_app(service=service, upload_api_key="secret")

    with TestClient(app_with_key) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.txt", b"content", "text/plain"))],
            data=_drive_id_fields(1),
            headers=headers,
        )

    assert response.status_code == 401
    service.process_files.assert_not_called()


@pytest.mark.integration
def test_upload_with_correct_api_key_reaches_service(app: FastAPI) -> None:
    service = Mock(spec=FileIngestionService)
    service.process_files.return_value = FileEmbeddingResponse(data=[])
    override_ingestion_service(app, service)
    app_with_key = create_app(service=service, upload_api_key="secret")

    with TestClient(app_with_key) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.txt", b"content", "text/plain"))],
            data=_drive_id_fields(1),
            headers={"Authorization": "Bearer secret"},
        )

    assert response.status_code == 200
    service.process_files.assert_called_once_with(
        (FileUpload("file.txt", "text/plain", b"content", "", "drive-0", ANY),),
    )


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
        ("files", (f"file-{index}.txt", b"content", "text/plain"))
        for index in range(11)
    ]

    with TestClient(app) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=files,
            data=_drive_id_fields(len(files)),
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
        UploadFile(file=handle, filename=f"file-{index}.txt")
        for index, handle in enumerate(file_handles)
    ]

    with pytest.raises(HTTPException) as raised:
        create_file_embeddings(
            files=uploads,
            file_path=None,
            drive_id=[f"drive-{index}" for index in range(len(uploads))],
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
        filename="oversized.txt",
        headers={"content-type": "text/plain"},
    )

    response = create_file_embeddings(
        files=[upload],
        file_path=None,
        drive_id=["drive-0"],
        service=service,
    )

    assert response.data[0].filename == "oversized.txt"
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
            files=[("files", ("empty.txt", b"", "text/plain"))],
            data=_drive_id_fields(1),
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "filename": "empty.txt",
            "content_type": "text/plain",
            "status": "failed",
            "reason": "Empty file",
        }
    ]
    description_client.describe.assert_not_called()
    model_client.embed_text.assert_not_called()
    qdrant_store.store_embedding.assert_not_called()


@pytest.mark.integration
def test_real_service_preserves_order_for_oversized_and_valid_files(
    app: FastAPI,
) -> None:
    description_client = Mock(spec=ImageDescriptionClient)
    model_client = Mock(spec=ModelClient)
    model_client.embed_text.return_value = [0.123456, -0.654321]
    qdrant_store = Mock(spec=QdrantStore)
    qdrant_store.store_embedding.return_value = "point-secret"
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)
    oversized = b"x" * (25 * 1024 * 1024 + 1)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[
                ("files", ("oversized.txt", oversized, "text/plain")),
                ("files", ("valid.txt", b"valid text", "text/plain")),
            ],
            data=_drive_id_fields(2),
        )

    assert response.status_code == 200
    assert response.json()["data"] == [
        {
            "filename": "oversized.txt",
            "content_type": "text/plain",
            "status": "failed",
            "reason": "File exceeds 25 MB limit",
        },
        {
            "filename": "valid.txt",
            "content_type": "text/plain",
            "status": "success",
            "reason": None,
        },
    ]
    serialized = response.text
    for forbidden in (
        "0.123456",
        "-0.654321",
        "point-secret",
        "sk-test-api-key",
        "Traceback (most recent call last)",
        "/Users/narutojaki/private.txt",
    ):
        assert forbidden not in serialized
    model_client.embed_text.assert_called_once_with("valid text")
    qdrant_store.store_embedding.assert_called_once_with(
        [0.123456, -0.654321], payload=None
    )


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
    model_client = Mock(spec=ModelClient)
    model_client.embed_text.side_effect = ModelEndpointError(error_message)
    qdrant_store = Mock(spec=QdrantStore)
    service = FileIngestionService(description_client, model_client, qdrant_store)
    app_with_service = create_app(service=service)

    with TestClient(app_with_service) as client:
        response = client.post(
            "/v1/file-embeddings",
            files=[("files", ("file.txt", b"valid text", "text/plain"))],
            data=_drive_id_fields(1),
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
            data=_drive_id_fields(1),
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
            files=[("files", ("file.txt", b"valid text", "text/plain"))],
            data=_drive_id_fields(1),
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["status"] == "failed"
    assert response.json()["data"][0]["reason"] == "Qdrant storage failure"
    model_client.embed_text.assert_called_once_with("valid text")
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
        "model": "ok",
        "drive": "disabled",
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
        "model": "unavailable"
        if "unavailable" in (description_status, embedding_status)
        else "ok",
        "drive": "disabled",
    }


@pytest.mark.integration
def test_health_reports_drive_ok_when_drive_dependency_is_ok(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    dependencies = HealthDependencies(
        description_client=_HealthDependency("ok"),
        model_client=_HealthDependency("ok"),
        qdrant_store=_HealthDependency("ok"),
        drive=_HealthDependency("ok"),
    )
    app_with_deps = create_app(service=service, health_dependencies=dependencies)

    with TestClient(app_with_deps) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "qdrant": "ok",
        "model": "ok",
        "drive": "ok",
    }


@pytest.mark.integration
def test_health_is_degraded_when_drive_dependency_is_unavailable(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)
    dependencies = HealthDependencies(
        description_client=_HealthDependency("ok"),
        model_client=_HealthDependency("ok"),
        qdrant_store=_HealthDependency("ok"),
        drive=_HealthDependency("unavailable"),
    )
    app_with_deps = create_app(service=service, health_dependencies=dependencies)

    with TestClient(app_with_deps) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "degraded",
        "qdrant": "ok",
        "model": "ok",
        "drive": "unavailable",
    }


@pytest.mark.integration
def test_injected_service_starts_once_on_testclient_lifespan(
    app: FastAPI,
) -> None:
    service = Mock(spec=FileIngestionService)

    with TestClient(create_app(service=service)):
        service.startup.assert_called_once_with()


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
            files=[("files", ("file.txt", b"content", "text/plain"))],
            data=_drive_id_fields(1),
        )

    assert response.status_code == 503
    assert response.json() == {"detail": "Model not found"}
