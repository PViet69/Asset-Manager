"""Admin API: trigger + inspect Drive sync."""

from fastapi import APIRouter, Depends, HTTPException, Request, status

from backend.app.api.schemas.admin import (
    AdminReindexResponse,
    AdminSyncResponse,
    AdminSyncStatusResponse,
)
from backend.app.drive.scheduler import SyncScheduler, SyncTickResult
from backend.app.security import require_admin_access

router = APIRouter(prefix="/admin", tags=["admin"])


def _get_scheduler(request: Request) -> SyncScheduler | None:
    scheduler: SyncScheduler | None = request.app.state.sync_scheduler
    return scheduler


@router.post(
    "/sync",
    response_model=AdminSyncResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def trigger_sync(
    request: Request,
) -> AdminSyncResponse:
    """Run one sync tick. 503 when Drive sync is not configured."""
    scheduler = _get_scheduler(request)
    if scheduler is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Drive sync is not configured",
        )
    result: SyncTickResult = await scheduler.tick_once()
    return AdminSyncResponse(
        upserted=result.upserted,
        deleted=result.deleted,
        unchanged=result.unchanged,
        failed=result.failed,
    )


@router.get(
    "/sync/status",
    response_model=AdminSyncStatusResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def sync_status(request: Request) -> AdminSyncStatusResponse:
    """Return whether the scheduler is enabled and the last tick summary."""
    scheduler = _get_scheduler(request)
    if scheduler is None:
        return AdminSyncStatusResponse(
            enabled=False,
            last_upserted=None,
            last_deleted=None,
            last_unchanged=None,
            last_failed=None,
        )
    last = scheduler.last_result
    return AdminSyncStatusResponse(
        enabled=True,
        last_upserted=last.upserted if last else None,
        last_deleted=last.deleted if last else None,
        last_unchanged=last.unchanged if last else None,
        last_failed=last.failed if last else None,
    )


@router.post(
    "/sync/reindex/{drive_id}",
    response_model=AdminReindexResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
async def reindex_drive_file(
    drive_id: str,
    request: Request,
) -> AdminReindexResponse:
    """Delete all stored points for one Drive file id, forcing a re-ingest."""
    scheduler = _get_scheduler(request)
    if scheduler is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Drive sync is not configured",
        )
    # Scheduler holds the qdrant_store privately; expose deletion via a public
    # helper would couple them. For now we go through the store directly via
    # the scheduler's underlying reference. (See follow-up: refactor Scheduler
    # to expose delete_for_reindex for testability.)
    deleted = await scheduler.delete_for_reindex(drive_id)
    return AdminReindexResponse(drive_id=drive_id, deleted=deleted)
