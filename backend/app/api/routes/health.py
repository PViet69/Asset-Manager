"""Health check API route."""

from dataclasses import dataclass

from fastapi import APIRouter, Depends, Request, status

from backend.app.api.schemas.health import HealthResponse, ProviderHealth
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.model.description_client import ImageDescriptionClient
from backend.app.storage.registry import ProviderRegistry

router = APIRouter()


@dataclass(frozen=True)
class HealthDependencies:
    """Dependencies used by the health check."""

    description_client: ImageDescriptionClient
    model_client: ModelClient
    qdrant_store: QdrantStore


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
    request: Request,
    dependencies: HealthDependencies = Depends(get_health_dependencies),
) -> HealthResponse:
    """Report image description, embedding, Qdrant, and Drive availability."""
    description_status = dependencies.description_client.check_health()
    embedding_status = dependencies.model_client.check_health()
    qdrant_status = dependencies.qdrant_store.check_health()
    registry: ProviderRegistry = getattr(
        request.app.state, "provider_registry", ProviderRegistry(())
    )
    provider_health = [
        ProviderHealth(provider=entry.name, status=entry.client.check_health())
        for entry in registry.providers
    ]
    # Disabled registered providers are expected, not a degradation.
    component_statuses = (
        description_status,
        embedding_status,
        qdrant_status,
        *(item.status for item in provider_health),
    )
    overall_status = (
        "ok"
        if all(s == "ok" or s == "disabled" for s in component_statuses)
        else "degraded"
    )
    return HealthResponse(
        status=overall_status,
        qdrant=qdrant_status,
        embedding_model=embedding_status,
        description_model=description_status,
        providers=provider_health,
    )
