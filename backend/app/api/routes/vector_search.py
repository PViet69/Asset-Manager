"""Vector search API route."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.schemas.vector_search import (
    StorageProviderInfo,
    VectorSearchRequest,
    VectorSearchResponse,
)
from backend.app.exceptions import (
    ModelEndpointError,
    ModelNotFoundError,
    QdrantStorageError,
    SettingsError,
)
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.security import require_upload_access
from backend.app.storage import StorageProvider
from backend.app.storage.registry import ProviderRegistry

router = APIRouter()


@router.post(
    "/v1/search",
    response_model=VectorSearchResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_upload_access)],
)
def search_vectors(
    payload: VectorSearchRequest,
    service: FileIngestionService = Depends(get_file_ingestion_service),
) -> VectorSearchResponse:
    """Search stored vectors by embedded query text."""
    try:
        return service.search(
            payload.query,
            limit=payload.limit,
            provider=payload.provider,
            mode=payload.mode,
        )
    except SettingsError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.safe_message,
        ) from exc
    except ModelNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.safe_message,
        ) from exc
    except ModelEndpointError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=exc.safe_message,
        ) from exc
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=exc.safe_message,
        ) from exc


@router.get(
    "/v1/providers",
    response_model=list[StorageProviderInfo],
    status_code=status.HTTP_200_OK,
)
def list_providers(request: Request) -> list[StorageProviderInfo]:
    """List available storage providers."""
    registry: ProviderRegistry = getattr(
        request.app.state, "provider_registry", ProviderRegistry(())
    )
    if registry.providers:
        return [
            StorageProviderInfo(id=entry.name, display_name=entry.display_name)
            for entry in registry.providers
        ]
    return [
        StorageProviderInfo(id=p.value, display_name=p.display_name)
        for p in StorageProvider
    ]

