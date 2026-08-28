"""Thread-safe in-process cache for provider thumbnails."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock
from time import monotonic

from backend.app.storage.client import Thumbnail

THUMBNAIL_CACHE_TTL_SECONDS = 300
MAX_THUMBNAIL_CACHE_ENTRIES = 256


@dataclass(frozen=True)
class _CacheEntry:
    thumbnail: Thumbnail
    expires_at: float


class ThumbnailCache:
    """Cache successful thumbnail fetches for a bounded time."""

    def __init__(
        self,
        ttl_seconds: float = THUMBNAIL_CACHE_TTL_SECONDS,
        max_entries: int = MAX_THUMBNAIL_CACHE_ENTRIES,
    ) -> None:
        self._ttl_seconds = ttl_seconds
        self._max_entries = max_entries
        self._entries: OrderedDict[tuple[str, str], _CacheEntry] = OrderedDict()
        self._lock = Lock()

    def get(self, provider: str, storage_file_id: str) -> Thumbnail | None:
        key = (provider, storage_file_id)
        with self._lock:
            entry = self._entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= monotonic():
                del self._entries[key]
                return None
            self._entries.move_to_end(key)
            return entry.thumbnail

    def set(self, provider: str, storage_file_id: str, thumbnail: Thumbnail) -> None:
        key = (provider, storage_file_id)
        entry = _CacheEntry(
            thumbnail=thumbnail,
            expires_at=monotonic() + self._ttl_seconds,
        )
        with self._lock:
            self._entries[key] = entry
            self._entries.move_to_end(key)
            self._remove_expired_entries()
            while len(self._entries) > self._max_entries:
                self._entries.popitem(last=False)

    def _remove_expired_entries(self) -> None:
        now = monotonic()
        expired_keys = tuple(
            key for key, entry in self._entries.items() if entry.expires_at <= now
        )
        for key in expired_keys:
            del self._entries[key]
