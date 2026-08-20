import pytest
from pydantic import ValidationError

from backend.app.api.schemas.file_embeddings import (
    ErrorDetail,
    FileEmbeddingItem,
    FileEmbeddingResponse,
)
from backend.app.api.schemas.health import HealthResponse


@pytest.mark.unit
def test_success_item_has_success_status() -> None:
    item = FileEmbeddingItem(
        filename="report.txt",
        content_type="text/plain",
        status="success",
        reason=None,
    )

    assert item.filename == "report.txt"
    assert item.status == "success"
    assert item.reason is None


@pytest.mark.unit
def test_failed_item_preserves_safe_reason() -> None:
    item = FileEmbeddingItem(
        filename="bad.bin",
        content_type="application/octet-stream",
        status="failed",
        reason="Unsupported file type",
    )

    assert item.status == "failed"
    assert item.reason == "Unsupported file type"


@pytest.mark.unit
def test_response_uses_list_object_marker() -> None:
    response = FileEmbeddingResponse(
        object="list",
        data=[FileEmbeddingItem(filename="x.txt", content_type="text/plain")],
    )

    assert response.object == "list"
    assert len(response.data) == 1


@pytest.mark.unit
def test_error_detail_requires_message_and_type() -> None:
    with pytest.raises(ValidationError):
        ErrorDetail(message="only message")


@pytest.mark.unit
def test_health_response_contains_dependency_statuses() -> None:
    response = HealthResponse(status="ok", qdrant="ok", model="ok", drive="disabled")

    assert response.model == "ok"
    assert response.drive == "disabled"


@pytest.mark.unit
def test_health_response_requires_drive_field() -> None:
    with pytest.raises(ValidationError):
        HealthResponse(status="ok", qdrant="ok", model="ok")
