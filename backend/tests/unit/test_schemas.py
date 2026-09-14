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
from backend.app.api.schemas.file_embeddings import ErrorDetail
from backend.app.api.schemas.health import HealthResponse, ProviderHealth
from backend.app.storage import StorageProvider


@pytest.mark.unit
def test_error_detail_requires_message_and_type() -> None:
    with pytest.raises(ValidationError):
        ErrorDetail(message="only message")


@pytest.mark.unit
def test_health_response_contains_provider_statuses() -> None:
    response = HealthResponse(
        status="ok",
        qdrant="ok",
        embedding_model="ok",
        description_model="ok",
        providers=[ProviderHealth(provider=StorageProvider.DROPBOX, status="disabled")],
    )

    assert response.embedding_model == "ok"
    assert response.description_model == "ok"
    assert response.providers == [
        ProviderHealth(provider=StorageProvider.DROPBOX, status="disabled")
    ]


@pytest.mark.unit
def test_health_response_defaults_to_no_registered_providers() -> None:
    response = HealthResponse(
        status="ok",
        qdrant="ok",
        embedding_model="ok",
        description_model="ok",
    )

    assert response.providers == []


@pytest.mark.unit
def test_dashboard_contract_dtos_serialize_expected_fields() -> None:
    provider = ProviderDashboardStatus(
        provider=StorageProvider.GOOGLE_DRIVE,
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
        provider=StorageProvider.GOOGLE_DRIVE,
        filename="asset.png",
        status="loading",
        detail="Downloading file",
    )
    terminal = SyncTerminalEvent(
        sequence=2,
        provider=StorageProvider.GOOGLE_DRIVE,
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
                provider=StorageProvider.GOOGLE_DRIVE,
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
                provider=StorageProvider.GOOGLE_DRIVE,
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
                provider=StorageProvider.GOOGLE_DRIVE,
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
