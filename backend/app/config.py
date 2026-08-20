from typing import Annotated

from pydantic import BeforeValidator, Field, StringConstraints, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

NonBlankSetting = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1),
]

OptionalFloatSetting = Annotated[
    float | None,
    BeforeValidator(
        lambda value: None if isinstance(value, str) and not value.strip() else value
    ),
]


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        frozen=True,
        extra="ignore",
    )

    MODEL_ENDPOINT_URL: str
    MODEL_ENDPOINT_API_KEY: str | None = None
    MODEL_REQUEST_TIMEOUT: float = Field(default=30, gt=0)
    UPLOAD_API_KEY: str | None = None
    DESCRIPTION_MODEL: NonBlankSetting
    DESCRIPTION_ENDPOINT_URL: str | None = None
    DESCRIPTION_ENDPOINT_API_KEY: str | None = None
    EMBEDDING_MODEL: NonBlankSetting

    QDRANT_URL: str
    QDRANT_API_KEY: str | None = None
    QDRANT_COLLECTION: str = "file_embeddings"
    QDRANT_VECTOR_SIZE: int = Field(gt=0)
    QDRANT_DISTANCE: str = "Cosine"
    SEARCH_THRESHOLD: OptionalFloatSetting = Field(default=None, ge=0, le=1)

    # Google Drive sync (optional). When both DRIVE_SERVICE_ACCOUNT_JSON and
    # DRIVE_FOLDER_ID are set, the scheduler starts; otherwise sync is disabled.
    DRIVE_SERVICE_ACCOUNT_JSON: str | None = None
    DRIVE_FOLDER_ID: str | None = None
    DRIVE_SYNC_INTERVAL_SECONDS: int = Field(default=2_592_000, gt=0)

    # Admin endpoints (optional). Separate from UPLOAD_API_KEY.
    ADMIN_API_KEY: str | None = None

    @model_validator(mode="after")
    def _validate_description_endpoint(self) -> "Settings":
        missing = [
            name
            for name, value in (
                ("DESCRIPTION_ENDPOINT_URL", self.DESCRIPTION_ENDPOINT_URL),
                ("DESCRIPTION_ENDPOINT_API_KEY", self.DESCRIPTION_ENDPOINT_API_KEY),
            )
            if value is None
        ]
        if missing:
            joined = " and ".join(missing)
            raise ValueError(
                f"{joined} must be set when DESCRIPTION_MODEL is configured"
            )
        return self
