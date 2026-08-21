"""Schemas for admin-only endpoints."""

from pydantic import BaseModel, ConfigDict


class SyncTraceItem(BaseModel):
    """Step-by-step execution trace log item."""

    model_config = ConfigDict(frozen=True)

    timestamp: str
    step: str
    status: str  # "success", "failed", "info"
    detail: str
    filename: str | None = None
    drive_id: str | None = None


class AdminSyncResponse(BaseModel):
    """Result of triggering a Drive sync tick."""

    model_config = ConfigDict(frozen=True)

    upserted: int
    deleted: int
    unchanged: int
    failed: int
    traces: list[SyncTraceItem] = []


class AdminSyncStatusResponse(BaseModel):
    """Status of the Drive sync scheduler."""

    model_config = ConfigDict(frozen=True)

    enabled: bool
    last_upserted: int | None
    last_deleted: int | None
    last_unchanged: int | None
    last_failed: int | None
    last_traces: list[SyncTraceItem] = []


class AdminReindexResponse(BaseModel):
    """Result of deleting all stored points for one Drive file id."""

    model_config = ConfigDict(frozen=True)

    drive_id: str
    deleted: int
