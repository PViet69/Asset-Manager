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


class ModelHealthStatus(BaseModel):
    """Safe configured model identity and availability."""

    model_config = ConfigDict(frozen=True)

    name: str
    health: str


class ProviderDashboardStatus(BaseModel):
    """Safe provider inventory and health for admin dashboard."""

    model_config = ConfigDict(frozen=True)

    provider: str
    display_name: str
    enabled: bool
    health: str
    detected_count: int | None
    embedded_count: int | None


class AdminDashboardStatusResponse(BaseModel):
    """Full dashboard status response."""

    model_config = ConfigDict(frozen=True)

    providers: list[ProviderDashboardStatus]
    embedding_model: ModelHealthStatus
    description_model: ModelHealthStatus


class AdminProviderRefreshResponse(BaseModel):
    """Provider refresh result with current model health."""

    model_config = ConfigDict(frozen=True)

    provider: ProviderDashboardStatus
    embedding_model: ModelHealthStatus
    description_model: ModelHealthStatus


class SyncActivityEvent(BaseModel):
    """Safe non-terminal provider sync activity event."""

    model_config = ConfigDict(frozen=True)

    sequence: int
    provider: str
    filename: str | None
    status: str
    detail: str
    terminal: bool = False


class SyncTerminalEvent(BaseModel):
    """Safe terminal provider sync event."""

    model_config = ConfigDict(frozen=True)

    sequence: int
    provider: str
    detected_count: int | None
    embedded_count: int | None
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    terminal: bool = True


class AdminReindexResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    storage_file_id: str
    deleted: int
