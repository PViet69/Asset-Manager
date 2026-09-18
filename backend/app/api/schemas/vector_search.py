"""Vector search API schemas."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from backend.app.storage import StorageProvider

DEFAULT_SEARCH_LIMIT = 10
MIN_SEARCH_LIMIT = 1
MAX_SEARCH_LIMIT = 100
MAX_SEARCH_QUERY_LENGTH = 4_190

SearchQuery = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=MAX_SEARCH_QUERY_LENGTH,
    ),
]
SearchTag = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
]
MAX_SEARCH_TAGS = 20


class VectorSearchRequest(BaseModel):
    """Validated vector search request."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    query: str = ""
    mode: Literal["semantic", "filename"] = "semantic"
    tags: list[SearchTag] = Field(default_factory=list, max_length=MAX_SEARCH_TAGS)
    limit: int = Field(
        default=DEFAULT_SEARCH_LIMIT, ge=MIN_SEARCH_LIMIT, le=MAX_SEARCH_LIMIT
    )
    provider: StorageProvider | None = None

    @model_validator(mode="after")
    def validate_mode_fields(self) -> "VectorSearchRequest":
        query = self.query.strip()
        tags = list(dict.fromkeys(self.tags))
        if not query:
            raise ValueError("Search query must not be blank")
        if len(query) > MAX_SEARCH_QUERY_LENGTH:
            raise ValueError(
                "Search query exceeds maximum allowed length of "
                f"{MAX_SEARCH_QUERY_LENGTH} characters"
            )
        return self.model_copy(update={"query": query, "tags": tags})


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
    provider: str | None = None
    storage_file_id: str | None = None
    thumbnail_url: str | None = None
    modified_time: str | None = None


class VectorSearchResponse(BaseModel):
    """Vector search response envelope."""

    model_config = ConfigDict(frozen=True)

    object: Literal["list"] = "list"
    data: list[VectorSearchItem]


class TagGroup(BaseModel):
    """One category of canonical searchable tags."""

    model_config = ConfigDict(frozen=True)

    category: str
    tags: list[str]


class ApprovedTagGroupsResponse(BaseModel):
    """Approved tags available to public tag search."""

    model_config = ConfigDict(frozen=True)

    groups: list[TagGroup]


class StorageProviderInfo(BaseModel):
    """Storage provider metadata returned to clients."""

    model_config = ConfigDict(frozen=True)

    id: str
    display_name: str
