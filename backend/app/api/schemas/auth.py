"""Schemas for single-admin authentication."""

from pydantic import BaseModel, ConfigDict, Field


class AdminLoginRequest(BaseModel):
    """Validated administrator login credentials."""

    model_config = ConfigDict(frozen=True)

    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)


class AdminAccountResponse(BaseModel):
    """Safe authenticated administrator identity."""

    model_config = ConfigDict(frozen=True)

    username: str
