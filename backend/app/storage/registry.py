"""Literal registered storage providers."""

from dataclasses import dataclass

from backend.app.config import Settings
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.storage.client import (
    DROPBOX_PROVIDER,
    GOOGLE_DRIVE_PROVIDER,
    StorageClient,
    build_dropbox_client,
    build_google_drive_client,
    is_dropbox_configured,
    is_google_drive_configured,
)
from backend.app.storage.scheduler import StorageSyncScheduler


@dataclass(frozen=True)
class ProviderSync:
    name: str
    display_name: str
    client: StorageClient
    scheduler: StorageSyncScheduler | None


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
            GOOGLE_DRIVE_PROVIDER,
            "Google Drive",
            drive_client,
            _build_scheduler(
                GOOGLE_DRIVE_PROVIDER,
                drive_client,
                settings.DRIVE_FOLDER_ID,
                is_google_drive_configured(settings),
                ingestion_service,
                qdrant_store,
            ),
        ),
        ProviderSync(
            DROPBOX_PROVIDER,
            "Dropbox",
            dropbox_client,
            _build_scheduler(
                DROPBOX_PROVIDER,
                dropbox_client,
                settings.DROPBOX_ROOT_PATH,
                is_dropbox_configured(settings),
                ingestion_service,
                qdrant_store,
            ),
        ),
    )
    return ProviderRegistry(entries)
