"""Unit tests for bounded in-process thumbnail cache."""

import pytest

from backend.app.storage import StorageProvider
from backend.app.storage.client import Thumbnail
from backend.app.storage.thumbnail_cache import ThumbnailCache


@pytest.mark.unit
def test_thumbnail_cache_expires_entries_after_ttl() -> None:
    cache = ThumbnailCache(ttl_seconds=0, max_entries=2)
    thumbnail = Thumbnail(b"image", "image/jpeg")

    cache.set(StorageProvider.DROPBOX, "photo-1", thumbnail)

    assert cache.get(StorageProvider.DROPBOX, "photo-1") is None


@pytest.mark.unit
def test_thumbnail_cache_evicts_oldest_live_entry_when_full() -> None:
    cache = ThumbnailCache(ttl_seconds=300, max_entries=1)

    cache.set(StorageProvider.DROPBOX, "photo-1", Thumbnail(b"first", "image/jpeg"))
    cache.set(StorageProvider.DROPBOX, "photo-2", Thumbnail(b"second", "image/jpeg"))

    assert cache.get(StorageProvider.DROPBOX, "photo-1") is None
    assert cache.get(StorageProvider.DROPBOX, "photo-2") == Thumbnail(
        b"second", "image/jpeg"
    )



