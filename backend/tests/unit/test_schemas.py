import pytest
from pydantic import ValidationError

from backend.app.api.schemas.admin import (
    AdminDashboardStatusResponse,
    AdminProviderRefreshResponse,
    ModelHealthStatus,
    ProviderDashboardStatus,
    SyncActivityEvent,
    SyncTerminalEvent,
)
from backend.app.api.schemas.file_embeddings import (
    ErrorDetail,
    FileEmbeddingItem,
    FileEmbeddingResponse,
)
from backend.app.api.schemas.health import HealthResponse, ProviderHealth


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
def test_health_response_contains_provider_statuses() -> None:
    response = HealthResponse(
        status="ok",
        qdrant="ok",
        model="ok",
        providers=[ProviderHealth(provider="dropbox", status="disabled")],
    )

    assert response.model == "ok"
    assert response.providers == [ProviderHealth(provider="dropbox", status="disabled")]


@pytest.mark.unit
def test_health_response_defaults_to_no_registered_providers() -> None:
    response = HealthResponse(status="ok", qdrant="ok", model="ok")

    assert response.providers == []


@pytest.mark.unit
def test_dashboard_contract_dtos_serialize_expected_fields() -> None:
    provider = ProviderDashboardStatus(
        provider="google_drive",
        display_name="Google Drive",
        enabled=True,
        health="ok",
        detected_count=3,
        embedded_count=2,
    )
    embedding_model = ModelHealthStatus(name="embed-v1", health="ok")
    description_model = ModelHealthStatus(name="describe-v1", health="unavailable")

    response = AdminDashboardStatusResponse(
        providers=[provider],
        embedding_model=embedding_model,
        description_model=description_model,
    )
    refresh = AdminProviderRefreshResponse(
        provider=provider,
        embedding_model=embedding_model,
        description_model=description_model,
    )
    activity = SyncActivityEvent(
        sequence=1,
        provider="google_drive",
        filename="asset.png",
        status="loading",
        detail="Downloading file",
    )
    terminal = SyncTerminalEvent(
        sequence=2,
        provider="google_drive",
        detected_count=3,
        embedded_count=2,
        upserted=2,
        deleted=0,
        unchanged=1,
        failed=0,
    )

    assert response.model_dump()["providers"][0]["embedded_count"] == 2
    assert refresh.model_dump()["description_model"]["health"] == "unavailable"
    assert activity.model_dump()["terminal"] is False
    assert terminal.model_dump()["terminal"] is True


@pytest.mark.unit
@pytest.mark.parametrize(
    "dto,field,value",
    [
        (ModelHealthStatus(name="embed-v1", health="ok"), "health", "unavailable"),
        (
            ProviderDashboardStatus(
                provider="google_drive",
                display_name="Google Drive",
                enabled=True,
                health="ok",
                detected_count=3,
                embedded_count=2,
            ),
            "detected_count",
            4,
        ),
        (
            SyncActivityEvent(
                sequence=1,
                provider="google_drive",
                filename=None,
                status="failed",
                detail="Sync failed",
            ),
            "sequence",
            2,
        ),
        (
            SyncTerminalEvent(
                sequence=2,
                provider="google_drive",
                detected_count=None,
                embedded_count=None,
                upserted=0,
                deleted=0,
                unchanged=0,
                failed=1,
            ),
            "failed",
            2,
        ),
    ],
)
def test_dashboard_contract_dtos_are_immutable(
    dto: object, field: str, value: object
) -> None:
    with pytest.raises(ValidationError, match="frozen"):
        setattr(dto, field, value)
