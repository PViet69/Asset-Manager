from pydantic import BaseModel, ConfigDict, Field


class ProviderHealth(BaseModel):
    model_config = ConfigDict(frozen=True)

    provider: str
    status: str


class HealthResponse(BaseModel):
    model_config = ConfigDict(frozen=True)

    status: str
    qdrant: str
    model: str
    providers: list[ProviderHealth] = Field(default_factory=list)
