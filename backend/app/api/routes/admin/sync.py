"""Provider-scoped manual storage sync API."""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import StreamingResponse

from backend.app.admin_dashboard.status_service import AdminDashboardStatusService
from backend.app.admin_dashboard.sync_stream import ProviderSyncStream
from backend.app.api.schemas.admin import (
    AdminDashboardStatusResponse,
    AdminProviderRefreshResponse,
    AdminReindexResponse,
    AdminSyncResponse,
)
from backend.app.security import require_admin_access, require_admin_origin
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import StorageSyncScheduler

router = APIRouter(prefix="/admin", tags=["admin"])


def _registry(request: Request) -> ProviderRegistry:
    return request.app.state.provider_registry


def _dashboard_service(request: Request) -> AdminDashboardStatusService:
    return request.app.state.admin_dashboard_status_service


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
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access), Depends(require_admin_origin)],
)
async def stop_sync(provider: str, request: Request) -> dict[str, str]:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    scheduler.stop_sync()
    return {"status": "stopping", "provider": provider}


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
