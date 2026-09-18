"""Vector search API route."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.app.api.dependencies import get_file_ingestion_service
from backend.app.api.schemas.vector_search import (
    ApprovedTagGroupsResponse,
    StorageProviderInfo,
    TagGroup,
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
from backend.app.tag_settings.parser import group_tags
from backend.app.tag_settings.store import TagSettingsStore

router = APIRouter()


@router.post(
    "/v1/search",
    response_model=VectorSearchResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_upload_access)],
)
def search_vectors(
    payload: VectorSearchRequest,
    request: Request,
    service: FileIngestionService = Depends(get_file_ingestion_service),
) -> VectorSearchResponse:
    """Search stored vectors or filenames with optional approved tag filters."""
    try:
        if payload.tags:
            store: TagSettingsStore = request.app.state.tag_settings_store
            approved_tags = set(store.get_approved_tags())
            if not set(payload.tags).issubset(approved_tags):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="One or more tags are not approved for search",
                )
        search_kwargs = {
            "limit": payload.limit,
            "provider": payload.provider,
            "mode": payload.mode,
        }
        if payload.tags:
            search_kwargs["tags"] = payload.tags
        return service.search(payload.query, **search_kwargs)
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
    "/v1/search/tags",
    response_model=ApprovedTagGroupsResponse,
    status_code=status.HTTP_200_OK,
)
async def list_approved_tags(request: Request) -> ApprovedTagGroupsResponse:
    """List persisted tags users may select for tag search."""
    store: TagSettingsStore = request.app.state.tag_settings_store
    try:
        groups = group_tags(await asyncio.to_thread(store.get_approved_tags))
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc
    return ApprovedTagGroupsResponse(
        groups=[
            TagGroup(category=category, tags=tags) for category, tags in groups.items()
        ]
    )


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
