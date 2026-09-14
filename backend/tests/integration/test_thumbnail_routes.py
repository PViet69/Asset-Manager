"""Integration tests for provider image thumbnail route."""

from dataclasses import dataclass
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.main import create_app
from backend.app.storage import StorageProvider
from backend.app.storage.client import (
    StorageThumbnailUnavailable,
    Thumbnail,
)
from backend.app.storage.registry import ProviderRegistry, ProviderSync
from backend.app.storage.thumbnail_cache import THUMBNAIL_CACHE_TTL_SECONDS
from backend.app.storage.thumbnail_service import IndexedThumbnailSource

THUMBNAIL_PATH = f"/v1/storage/{StorageProvider.DROPBOX}/id:photo/thumbnail"


@dataclass(frozen=True)
class _Scheduler:
    provider: str = StorageProvider.DROPBOX


def _app(
    source: IndexedThumbnailSource | None = IndexedThumbnailSource(
        StorageProvider.DROPBOX, "id:photo", "image/png"
    ),
    thumbnail: Thumbnail | None = Thumbnail(b"small-image", "image/jpeg"),
    enabled: bool = True,
):
    service = Mock(spec=FileIngestionService)
    service.find_indexed_thumbnail_source.return_value = source
    client = Mock()
    if thumbnail is not None:
        client.get_thumbnail.return_value = thumbnail
    else:
        client.get_thumbnail.side_effect = StorageThumbnailUnavailable()
    registry = ProviderRegistry(
        (
            ProviderSync(
                StorageProvider.DROPBOX,
                "Dropbox",
                client,
                _Scheduler() if enabled else None,
            ),
        )
    )
    return create_app(service=service, provider_registry=registry), client


@pytest.mark.integration
def test_thumbnail_returns_cached_private_image_bytes_for_indexed_image() -> None:
    app, provider_client = _app()

    with TestClient(app) as client:
        first_response = client.get(THUMBNAIL_PATH)
        second_response = client.get(THUMBNAIL_PATH)

    assert first_response.status_code == 200
    assert first_response.content == b"small-image"
    assert first_response.headers["content-type"] == "image/jpeg"
    assert (
        first_response.headers["cache-control"]
        == f"private, max-age={THUMBNAIL_CACHE_TTL_SECONDS}"
    )
    assert second_response.content == first_response.content
    provider_client.get_thumbnail.assert_called_once_with("id:photo")


@pytest.mark.integration
def test_thumbnail_does_not_call_provider_for_unknown_indexed_source() -> None:
    app, provider_client = _app(source=None)

    with TestClient(app) as client:
        response = client.get(THUMBNAIL_PATH)

    assert response.status_code == 404
    provider_client.get_thumbnail.assert_not_called()


@pytest.mark.integration
def test_thumbnail_returns_503_for_disabled_provider() -> None:
    app, provider_client = _app(enabled=False)

    with TestClient(app) as client:
        response = client.get(THUMBNAIL_PATH)

    assert response.status_code == 503
    provider_client.get_thumbnail.assert_not_called()


@pytest.mark.integration
def test_thumbnail_hides_provider_failure_details() -> None:
    app, _ = _app(thumbnail=None)

    with TestClient(app) as client:
        response = client.get(THUMBNAIL_PATH)

    assert response.status_code == 502
    assert "Storage thumbnail unavailable" not in response.json()["detail"]


@pytest.mark.integration
def test_thumbnail_rate_limits_request() -> None:
    app, _ = _app()

    with TestClient(app) as client:
        app.state.upload_rate_limiter.allow = Mock(return_value=False)
        response = client.get(THUMBNAIL_PATH)

    assert response.status_code == 429
