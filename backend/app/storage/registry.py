"""Literal registered storage providers."""

import threading
import time
from dataclasses import dataclass, field

from backend.app.config import Settings
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.storage import StorageProvider
from backend.app.storage.client import (
    StorageClient,
    build_dropbox_client,
    build_google_drive_client,
    is_dropbox_configured,
    is_google_drive_configured,
)
from backend.app.storage.scheduler import StorageSyncScheduler

HEALTH_CACHE_TTL_SECONDS = 5 * 60


class ProviderHealthCache:
    """Cache serialized provider health checks for a bounded interval."""

    def __init__(self, client: StorageClient) -> None:
        self._client = client
        self._lock = threading.Lock()
        self._health = "unknown"
        self._checked_at = 0.0

    def get(self) -> str:
        """Return cached health, refreshing only after cache expiry."""
        with self._lock:
            if time.monotonic() - self._checked_at < HEALTH_CACHE_TTL_SECONDS:
                return self._health
        return self.refresh()

    def refresh(self) -> str:
        """Run a provider health check and replace cached health."""
        try:
            new_health = self._client.check_health()
        except Exception:  # noqa: BLE001
            new_health = "unavailable"
        with self._lock:
            self._health = new_health
            self._checked_at = time.monotonic()
            return self._health


@dataclass(frozen=True)
class ProviderSync:
    name: str
    display_name: str
    client: StorageClient
    scheduler: StorageSyncScheduler | None
    root: str | None = None
    health_cache: ProviderHealthCache = field(init=False)

    def __post_init__(self) -> None:
        object.__setattr__(self, "health_cache", ProviderHealthCache(self.client))


@dataclass(frozen=True)
class ProviderRegistry:
    providers: tuple[ProviderSync, ...]

    def get(self, provider: str) -> ProviderSync | None:
        return next((item for item in self.providers if item.name == provider), None)


def _build_scheduler(
    provider: str,
    client: StorageClient,
    root: str | None,
    is_configured: bool,
    ingestion_service: FileIngestionService,
    qdrant_store: QdrantStore,
) -> StorageSyncScheduler | None:
    if not is_configured or root is None:
        return None
    return StorageSyncScheduler(provider, client, root, ingestion_service, qdrant_store)


def build_provider_registry(
    settings: Settings,
    ingestion_service: FileIngestionService,
    qdrant_store: QdrantStore,
) -> ProviderRegistry:
    drive_client = build_google_drive_client(settings)
    dropbox_client = build_dropbox_client(settings)
    entries = (
        ProviderSync(
            StorageProvider.GOOGLE_DRIVE,
            StorageProvider.GOOGLE_DRIVE.display_name,
            drive_client,
            _build_scheduler(
                StorageProvider.GOOGLE_DRIVE,
                drive_client,
                settings.DRIVE_FOLDER_ID,
                is_google_drive_configured(settings),
                ingestion_service,
                qdrant_store,
            ),
            settings.DRIVE_FOLDER_ID,
        ),
        ProviderSync(
            StorageProvider.DROPBOX,
            StorageProvider.DROPBOX.display_name,
            dropbox_client,
            _build_scheduler(
                StorageProvider.DROPBOX,
                dropbox_client,
                settings.DROPBOX_ROOT_PATH,
                is_dropbox_configured(settings),
                ingestion_service,
                qdrant_store,
            ),
            settings.DROPBOX_ROOT_PATH,
        ),
    )

    return ProviderRegistry(entries)
