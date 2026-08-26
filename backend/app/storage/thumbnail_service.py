"""Validated retrieval of indexed provider image thumbnails."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from backend.app.storage.client import (
    StorageThumbnailNotFound,
    StorageThumbnailUnavailable,
    Thumbnail,
)

if TYPE_CHECKING:
    from backend.app.file_embeddings.ingestion_service import FileIngestionService
    from backend.app.storage.registry import ProviderRegistry

SUPPORTED_THUMBNAIL_MIME_TYPES: frozenset[str] = frozenset(
    {"image/png", "image/jpeg", "image/webp"}
)


@dataclass(frozen=True)
class IndexedThumbnailSource:
    provider: str
    storage_file_id: str
    file_type: str


class ThumbnailSourceNotFound(Exception):
    """Raised when requested source is not an indexed provider image."""

    def __init__(self) -> None:
        super().__init__("Thumbnail source not found")


class UnsupportedThumbnailSource(Exception):
    """Raised when indexed source cannot have a thumbnail."""

    def __init__(self) -> None:
        super().__init__("Thumbnail source is not a supported image")


class ThumbnailProviderDisabled(Exception):
    """Raised when indexed provider is not configured."""

    def __init__(self) -> None:
        super().__init__("Thumbnail provider is not configured")


class ThumbnailProviderUnavailable(Exception):
    """Raised when provider cannot retrieve a thumbnail."""

    def __init__(self) -> None:
        super().__init__("Thumbnail provider is unavailable")


class ThumbnailService:
    """Authorize indexed thumbnail lookup before provider dispatch."""

    def __init__(
        self, registry: ProviderRegistry, ingestion_service: "FileIngestionService"
    ) -> None:
        self._registry = registry
        self._ingestion_service = ingestion_service

    def get_thumbnail(self, provider: str, storage_file_id: str) -> Thumbnail:
        source = self._ingestion_service.find_indexed_thumbnail_source(
            provider, storage_file_id
        )
        if source is None:
            raise ThumbnailSourceNotFound()
        if source.file_type not in SUPPORTED_THUMBNAIL_MIME_TYPES:
            raise UnsupportedThumbnailSource()
        entry = self._registry.get(provider)
        if entry is None:
            raise ThumbnailSourceNotFound()
        if entry.scheduler is None:
            raise ThumbnailProviderDisabled()
        try:
            return entry.client.get_thumbnail(storage_file_id)
        except StorageThumbnailNotFound as exc:
            raise ThumbnailSourceNotFound() from exc
        except StorageThumbnailUnavailable as exc:
            raise ThumbnailProviderUnavailable() from exc
