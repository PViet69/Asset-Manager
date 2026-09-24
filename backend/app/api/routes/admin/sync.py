"""Provider-scoped manual storage sync API."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from backend.app.admin_dashboard.status_service import AdminDashboardStatusService
from backend.app.admin_dashboard.sync_stream import ProviderSyncStream
from backend.app.api.schemas.admin import (
    AdminDashboardStatusResponse,
    AdminDeletePointResponse,
    AdminProviderRefreshResponse,
    AdminQdrantItemsResponse,
    AdminReindexResponse,
    AdminSyncResponse,
    AdminSyncStopResponse,
    AdminTagDiscoveryResponse,
    AdminTagGroup,
    AdminTagGroupsResponse,
    QdrantItemSchema,
    SaveAdminTagsRequest,
)
from backend.app.exceptions import ModelNotFoundError, QdrantStorageError
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.security import require_admin_access, require_admin_origin
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import StorageSyncScheduler
from backend.app.tag_settings.parser import group_tags
from backend.app.tag_settings.store import TagSettingsStore

router = APIRouter(prefix="/admin", tags=["admin"])


def _registry(request: Request) -> ProviderRegistry:
    return request.app.state.provider_registry


def _dashboard_service(request: Request) -> AdminDashboardStatusService:
    return request.app.state.admin_dashboard_status_service


def _tag_settings_store(request: Request) -> TagSettingsStore:
    return request.app.state.tag_settings_store


def _provider_or_404(request: Request, provider: str) -> ProviderSync:
    entry = _registry(request).get(provider)
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown storage provider"
        )
    return entry


def _scheduler_or_503(entry: ProviderSync) -> StorageSyncScheduler:
    if entry.scheduler is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{entry.display_name} sync is not configured",
        )
    return entry.scheduler


def _require_available_embedding_model(request: Request) -> None:
    model_client = request.app.state.health_dependencies.model_client
    if model_client.check_health() == "unavailable":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=ModelNotFoundError().safe_message,
        )


@router.get(
    "/tags",
    response_model=AdminTagGroupsResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def list_tags(request: Request) -> AdminTagGroupsResponse:
    """List saved approved tags for administration."""
    try:
        tags = await asyncio.to_thread(_tag_settings_store(request).get_approved_tags)
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc
    groups = group_tags(tags)
    return AdminTagGroupsResponse(
        groups=[
            AdminTagGroup(category=category, tags=tags)
            for category, tags in groups.items()
        ]
    )


@router.put(
    "/tags",
    response_model=AdminTagGroupsResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def save_tags(
    payload: SaveAdminTagsRequest, request: Request
) -> AdminTagGroupsResponse:
    """Persist selected tags from admin's discovery snapshot."""
    if not payload.selected_tags_are_discovered():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Approved tags must come from discovered tags",
        )
    try:
        saved = await asyncio.to_thread(
            _tag_settings_store(request).replace_approved_tags, payload.approved_tags
        )
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc
    groups = group_tags(saved)
    return AdminTagGroupsResponse(
        groups=[
            AdminTagGroup(category=category, tags=tags)
            for category, tags in groups.items()
        ]
    )


@router.post(
    "/tags/discover",
    response_model=AdminTagDiscoveryResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def discover_tags(request: Request) -> AdminTagDiscoveryResponse:
    """Index content-derived tags and return current discovery results."""
    try:
        result = await asyncio.to_thread(
            _tag_settings_store(request).discover_and_index
        )
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc
    groups = group_tags(result.tags)
    return AdminTagDiscoveryResponse(
        indexed_assets=result.indexed_assets,
        groups=[
            AdminTagGroup(category=category, tags=tags)
            for category, tags in groups.items()
        ],
    )


@router.post(
    "/sync/{provider}",
    response_model=AdminSyncResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def trigger_sync(provider: str, request: Request) -> AdminSyncResponse:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    result = await scheduler.tick_once()
    await asyncio.to_thread(_provider_or_404(request, provider).health_cache.refresh)
    return AdminSyncResponse(
        provider=result.provider,
        upserted=result.upserted,
        deleted=result.deleted,
        unchanged=result.unchanged,
        failed=result.failed,
        traces=list(result.traces),
    )


@router.get(
    "/sync/status",
    response_model=AdminDashboardStatusResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def sync_status(request: Request) -> AdminDashboardStatusResponse:
    return await _dashboard_service(request).get_status()


@router.post(
    "/sync/{provider}/refresh",
    response_model=AdminProviderRefreshResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def refresh_provider(
    provider: str, request: Request
) -> AdminProviderRefreshResponse:
    _provider_or_404(request, provider)
    try:
        return await _dashboard_service(request).refresh_provider(provider)
    except KeyError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Unknown storage provider"
        ) from None


@router.post(
    "/sync/{provider}/stream",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def stream_sync(provider: str, request: Request) -> StreamingResponse:
    _require_available_embedding_model(request)
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))

    async def snapshot(selected_provider: str):
        return (
            await _dashboard_service(request).refresh_provider(selected_provider)
        ).provider

    stream = ProviderSyncStream(provider, scheduler, snapshot)
    return StreamingResponse(
        stream.run(),
        media_type="text/event-stream",
        headers={"Content-Encoding": "identity", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/sync/{provider}/stop",
    response_model=AdminSyncStopResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def stop_sync(provider: str, request: Request) -> AdminSyncStopResponse:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    status_value = "stopping" if scheduler.stop_sync() else "unavailable"
    return AdminSyncStopResponse(status=status_value, provider=provider)


@router.post(
    "/sync/{provider}/reindex/{storage_file_id}",
    response_model=AdminReindexResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def reindex_storage_file(
    provider: str, storage_file_id: str, request: Request
) -> AdminReindexResponse:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    deleted = await scheduler.delete_for_reindex(storage_file_id)
    return AdminReindexResponse(
        provider=provider, storage_file_id=storage_file_id, deleted=deleted
    )


@router.get(
    "/sync/{provider}/items",
    response_model=AdminQdrantItemsResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def list_provider_items(
    provider: str, request: Request
) -> AdminQdrantItemsResponse:
    _provider_or_404(request, provider)
    qdrant_store = request.app.state.health_dependencies.qdrant_store
    try:
        hits = await asyncio.to_thread(qdrant_store.find_all_with_storage_key, provider)
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc

    items = [
        QdrantItemSchema(
            point_id=hit.point_id,
            filename=hit.payload.get("filename")
            or hit.payload.get("file_path")
            or hit.point_id,
            file_path=hit.payload.get("file_path"),
            storage_file_id=hit.payload.get("storage_file_id"),
            file_type=hit.payload.get("file_type"),
            thumbnail_url=FileIngestionService._thumbnail_url(
                provider,
                hit.payload.get("storage_file_id"),
                hit.payload.get("file_type"),
            ),
            modified_time=hit.payload.get("modified_time"),
        )
        for hit in hits
    ]
    return AdminQdrantItemsResponse(provider=provider, items=items)


@router.post(
    "/sync/qdrant/delete/{point_id}",
    response_model=AdminDeletePointResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def delete_qdrant_point(
    point_id: str, request: Request
) -> AdminDeletePointResponse:
    qdrant_store = request.app.state.health_dependencies.qdrant_store
    try:
        deleted = await asyncio.to_thread(qdrant_store.delete_by_point_ids, [point_id])
    except QdrantStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail=exc.safe_message
        ) from exc
    return AdminDeletePointResponse(point_id=point_id, deleted=deleted)
