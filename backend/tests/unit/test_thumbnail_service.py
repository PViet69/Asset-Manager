"""Unit tests for indexed provider thumbnail retrieval."""

from dataclasses import dataclass
from unittest.mock import Mock

import pytest

from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.storage.client import (
    StorageThumbnailNotFound,
    StorageThumbnailUnavailable,
    Thumbnail,
)
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.thumbnail_service import (
    IndexedThumbnailSource,
    ThumbnailProviderDisabled,
    ThumbnailProviderUnavailable,
    ThumbnailService,
    ThumbnailSourceNotFound,
    UnsupportedThumbnailSource,
)


@dataclass(frozen=True)
class _Scheduler:
    provider: str


def _registry(
    client: Mock, scheduler: _Scheduler | None = _Scheduler("dropbox")
) -> ProviderRegistry:
    return ProviderRegistry((ProviderSync("dropbox", "Dropbox", client, scheduler),))


@pytest.mark.unit
def test_indexed_thumbnail_source_is_immutable() -> None:
    source = IndexedThumbnailSource("dropbox", "id:photo", "image/png")

    with pytest.raises((AttributeError, TypeError)):
        source.file_type = "image/jpeg"  # type: ignore[misc]


@pytest.mark.unit
def test_find_indexed_thumbnail_source_requires_exact_identity() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = None
    client = Mock()
    service = ThumbnailService(_registry(client), ingestion)

    with pytest.raises(ThumbnailSourceNotFound):
        service.get_thumbnail("dropbox", "id:not-indexed")

    client.get_thumbnail.assert_not_called()


@pytest.mark.unit
def test_thumbnail_service_rejects_indexed_non_image() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = IndexedThumbnailSource(
        "dropbox", "id:pdf", "application/pdf"
    )
    client = Mock()

    with pytest.raises(UnsupportedThumbnailSource):
        ThumbnailService(_registry(client), ingestion).get_thumbnail(
            "dropbox", "id:pdf"
        )

    client.get_thumbnail.assert_not_called()


@pytest.mark.unit
def test_thumbnail_service_rejects_disabled_provider() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = IndexedThumbnailSource(
        "dropbox", "id:photo", "image/png"
    )
    client = Mock()

    with pytest.raises(ThumbnailProviderDisabled):
        ThumbnailService(_registry(client, scheduler=None), ingestion).get_thumbnail(
            "dropbox", "id:photo"
        )

    client.get_thumbnail.assert_not_called()


@pytest.mark.unit
def test_thumbnail_service_maps_provider_errors_without_leaking_details() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = IndexedThumbnailSource(
        "dropbox", "id:photo", "image/png"
    )
    client = Mock()
    client.get_thumbnail.side_effect = StorageThumbnailUnavailable()

    with pytest.raises(ThumbnailProviderUnavailable) as raised:
        ThumbnailService(_registry(client), ingestion).get_thumbnail(
            "dropbox", "id:photo"
        )

    assert "Storage thumbnail unavailable" not in str(raised.value)


@pytest.mark.unit
def test_thumbnail_service_returns_provider_thumbnail_for_indexed_image() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = IndexedThumbnailSource(
        "dropbox", "id:photo", "image/png"
    )
    client = Mock()
    client.get_thumbnail.return_value = Thumbnail(b"image", "image/jpeg")
    service = ThumbnailService(_registry(client), ingestion)

    first_thumbnail = service.get_thumbnail("dropbox", "id:photo")
    second_thumbnail = service.get_thumbnail("dropbox", "id:photo")

    assert first_thumbnail == Thumbnail(b"image", "image/jpeg")
    assert second_thumbnail == first_thumbnail
    client.get_thumbnail.assert_called_once_with("id:photo")


@pytest.mark.unit
def test_thumbnail_service_maps_provider_not_found_to_source_not_found() -> None:
    ingestion = Mock(spec=FileIngestionService)
    ingestion.find_indexed_thumbnail_source.return_value = IndexedThumbnailSource(
        "dropbox", "id:photo", "image/png"
    )
    client = Mock()
    client.get_thumbnail.side_effect = StorageThumbnailNotFound()

    with pytest.raises(ThumbnailSourceNotFound):
        ThumbnailService(_registry(client), ingestion).get_thumbnail(
            "dropbox", "id:photo"
        )
