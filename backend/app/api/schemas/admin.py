"""Schemas for admin-only endpoints."""

from pydantic import BaseModel, ConfigDict


class AdminSyncResponse(BaseModel):
    """Result of triggering a Drive sync tick."""

    model_config = ConfigDict(frozen=True)

    upserted: int
    deleted: int
    unchanged: int
    failed: int


class AdminSyncStatusResponse(BaseModel):
    """Status of the Drive sync scheduler."""

    model_config = ConfigDict(frozen=True)

    enabled: bool
    last_upserted: int | None
    last_deleted: int | None
    last_unchanged: int | None
    last_failed: int | None


class AdminReindexResponse(BaseModel):
    """Result of deleting all stored points for one Drive file id."""

    model_config = ConfigDict(frozen=True)

    drive_id: str
    deleted: int
