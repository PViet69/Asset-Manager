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
    embedded_delta: int = Field(default=0, ge=0, le=1)


class AdminSyncQueuedResponse(BaseModel):
    """Accepted provider sync task."""

    model_config = ConfigDict(frozen=True)

    job_id: str
    provider: str
    state: str


class AdminSyncConflictResponse(BaseModel):
    """Existing active provider sync task."""

    model_config = ConfigDict(frozen=True)

    detail: str
    job_id: str


class AdminSyncJobActivityResponse(BaseModel):
    """One safe, ordered ingestion lifecycle event."""

    model_config = ConfigDict(frozen=True)

    sequence: int = Field(ge=1)
    storage_file_id: str = Field(min_length=1, max_length=255)
    filename: str = Field(min_length=1, max_length=255)
    status: str = Field(pattern="^(preparing|indexing|indexed|failed|stopped)$")


class AdminSyncJobStatusResponse(BaseModel):
    """Safe queue job progress visible to administrators."""

    model_config = ConfigDict(frozen=True)

    job_id: str
    provider: str
    state: str
    attempt: int
    phase: str | None
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    cancellation_requested: bool
    detail: str | None
    embedded_delta: int = Field(default=0, ge=0)
    activity: list[AdminSyncJobActivityResponse] = Field(
        default_factory=list, max_length=50
    )


class AdminSyncStopResponse(BaseModel):
    """Provider sync stop request result."""

    model_config = ConfigDict(frozen=True)

    provider: str
    status: str


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


class AdminTagGroup(BaseModel):
    """One categorized canonical tag group for administration."""

    model_config = ConfigDict(frozen=True)

    category: str
    tags: list[str]


class AdminTagGroupsResponse(BaseModel):
    """Current approved tags grouped for administration."""

    model_config = ConfigDict(frozen=True)

    groups: list[AdminTagGroup]


class AdminTagDiscoveryResponse(AdminTagGroupsResponse):
    """Completed asset tag discovery and indexing summary."""

    indexed_assets: int


class SaveAdminTagsRequest(BaseModel):
    """Discovered tag snapshot and selected tags to approve."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    discovered_tags: list[str]
    approved_tags: list[str]

    def selected_tags_are_discovered(self) -> bool:
        """Return whether all selected tags originated in current discovery."""
        return set(self.approved_tags).issubset(set(self.discovered_tags))


class AdminReindexResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    storage_file_id: str
    deleted: int


class AdminDeletePointResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    point_id: str
    deleted: int


class QdrantItemSchema(BaseModel):
    model_config = ConfigDict(frozen=True)

    point_id: str
    filename: str | None = None
    file_path: str | None = None
    storage_file_id: str | None = None
    file_type: str | None = None
    thumbnail_url: str | None = None
    modified_time: str | None = None


class AdminQdrantItemsResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    items: list[QdrantItemSchema]
