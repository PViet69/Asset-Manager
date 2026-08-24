"""Provider-scoped manual storage sync API."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.app.api.schemas.admin import (
    AdminReindexResponse,
    AdminSyncResponse,
    AdminSyncStatusResponse,
    ProviderSyncStatus,
)
from backend.app.security import require_admin_access
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.scheduler import StorageSyncScheduler

router = APIRouter(prefix="/admin", tags=["admin"])


def _registry(request: Request) -> ProviderRegistry:
    return request.app.state.provider_registry


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
    dependencies=[Depends(require_admin_access)],
)
async def trigger_sync(provider: str, request: Request) -> AdminSyncResponse:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    result = await scheduler.tick_once()
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
    response_model=AdminSyncStatusResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def sync_status(request: Request) -> AdminSyncStatusResponse:
    providers = []
    for entry in _registry(request).providers:
        last = entry.scheduler.last_result if entry.scheduler else None
        providers.append(
            ProviderSyncStatus(
                provider=entry.name,
                display_name=entry.display_name,
                enabled=entry.scheduler is not None,
                health=entry.client.check_health(),
                last_upserted=last.upserted if last else None,
                last_deleted=last.deleted if last else None,
                last_unchanged=last.unchanged if last else None,
                last_failed=last.failed if last else None,
                last_traces=list(last.traces) if last else [],
            )
        )
    return AdminSyncStatusResponse(providers=providers)


@router.post(
    "/sync/{provider}/reindex/{storage_file_id}",
    response_model=AdminReindexResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def reindex_storage_file(
    provider: str, storage_file_id: str, request: Request
) -> AdminReindexResponse:
    scheduler = _scheduler_or_503(_provider_or_404(request, provider))
    deleted = await scheduler.delete_for_reindex(storage_file_id)
    return AdminReindexResponse(
        provider=provider, storage_file_id=storage_file_id, deleted=deleted
    )
