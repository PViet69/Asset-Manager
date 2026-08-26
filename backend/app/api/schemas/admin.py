"""Schemas for provider-scoped admin sync endpoints."""

from pydantic import BaseModel, ConfigDict, Field


class SyncTraceItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    timestamp: str
    provider: str
    step: str
    status: str
    detail: str
    filename: str | None = None
    storage_file_id: str | None = None


class AdminSyncResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    traces: list[SyncTraceItem] = Field(default_factory=list)


class ProviderSyncStatus(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    display_name: str
    enabled: bool
    health: str
    last_upserted: int | None = None
    last_deleted: int | None = None
    last_unchanged: int | None = None
    last_failed: int | None = None
    last_traces: list[SyncTraceItem] = Field(default_factory=list)


class AdminSyncStatusResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    providers: list[ProviderSyncStatus]


class AdminReindexResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    storage_file_id: str
    deleted: int
