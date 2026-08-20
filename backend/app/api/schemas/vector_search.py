"""Vector search API schemas."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

DEFAULT_SEARCH_LIMIT = 10
MIN_SEARCH_LIMIT = 1
MAX_SEARCH_LIMIT = 100
MAX_SEARCH_QUERY_LENGTH = 8_192

SearchQuery = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_SEARCH_QUERY_LENGTH,
    ),
]


class VectorSearchRequest(BaseModel):
    """Validated vector search request."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    query: SearchQuery
    limit: int = Field(
        default=DEFAULT_SEARCH_LIMIT, ge=MIN_SEARCH_LIMIT, le=MAX_SEARCH_LIMIT
    )


class VectorSearchItem(BaseModel):
    """One public vector search result."""

    model_config = ConfigDict(frozen=True)

    point_id: str
    score: float
    filename: str
    file_path: str
    file_type: str
    content: str
    source_url: str | None = None


class VectorSearchResponse(BaseModel):
    """Vector search response envelope."""

    model_config = ConfigDict(frozen=True)

    object: Literal["list"] = "list"
    data: list[VectorSearchItem]
