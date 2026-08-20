"""Health check API route."""

from dataclasses import dataclass
from typing import Protocol

from fastapi import APIRouter, Depends, status

from backend.app.api.schemas.health import HealthResponse
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.model.description_client import ImageDescriptionClient

router = APIRouter()


class DriveHealthChecker(Protocol):
    """Subset of DriveClient behavior needed for the health endpoint."""

    def check_health(self) -> str: ...


@dataclass(frozen=True)
class HealthDependencies:
    """Dependencies used by the health check."""

    description_client: ImageDescriptionClient
    model_client: ModelClient
    qdrant_store: QdrantStore
    drive: DriveHealthChecker | None = None


_HEALTH_DEPENDENCIES: HealthDependencies | None = None


def get_health_dependencies() -> HealthDependencies:
    """Return configured health check dependencies."""
    if _HEALTH_DEPENDENCIES is None:
        raise RuntimeError("Health dependencies are not configured")
    return _HEALTH_DEPENDENCIES


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
)
def health(
    dependencies: HealthDependencies = Depends(get_health_dependencies),
) -> HealthResponse:
    """Report image description, embedding, Qdrant, and Drive availability."""
    description_status = dependencies.description_client.check_health()
    model_status = dependencies.model_client.check_health()
    qdrant_status = dependencies.qdrant_store.check_health()
    drive_status = (
        dependencies.drive.check_health()
        if dependencies.drive is not None
        else "disabled"
    )
    model_status_combined = (
        "unavailable" if "unavailable" in (description_status, model_status) else "ok"
    )
    # "disabled" is expected (Drive not configured), not a degradation.
    component_statuses = (
        description_status,
        model_status,
        qdrant_status,
        drive_status,
    )
    overall_status = (
        "ok"
        if all(s == "ok" or s == "disabled" for s in component_statuses)
        else "degraded"
    )
    return HealthResponse(
        status=overall_status,
        qdrant=qdrant_status,
        model=model_status_combined,
        drive=drive_status,
    )
