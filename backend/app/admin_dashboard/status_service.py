"""Safe provider and model status collection for admin dashboard."""

import asyncio
import logging
from dataclasses import dataclass
from typing import Protocol

from backend.app.api.schemas.admin import (
    AdminDashboardStatusResponse,
    AdminProviderRefreshResponse,
    ModelHealthStatus,
    ProviderDashboardStatus,
)
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.model.description_client import ImageDescriptionClient
from backend.app.storage.registry import ProviderRegistry, ProviderSync

logger = logging.getLogger(__name__)


class _ModelHealthClient(Protocol):
    @property
    def model_name(self) -> str: ...

    def check_health(self) -> str: ...


@dataclass(frozen=True)
class AdminDashboardStatusService:
    """Collect safe dashboard metrics without mutating provider data."""

    registry: ProviderRegistry
    qdrant_store: QdrantStore
    embedding_client: ModelClient
    description_client: ImageDescriptionClient

    async def get_status(self) -> AdminDashboardStatusResponse:
        """Return current independent provider and model snapshots."""
        provider_tasks = tuple(
            self._provider_status(entry, force_health=False)
            for entry in self.registry.providers
        )
        providers = await asyncio.gather(*provider_tasks)
        embedding_model, description_model = await asyncio.gather(
            self._model_health(self.embedding_client),
            self._model_health(self.description_client),
        )
        return AdminDashboardStatusResponse(
            providers=list(providers),
            embedding_model=embedding_model,
            description_model=description_model,
        )

    async def refresh_provider(self, provider: str) -> AdminProviderRefreshResponse:
        """Refresh one provider snapshot and global model health only."""
        entry = self.registry.get(provider)
        if entry is None:
            raise KeyError(provider)
        provider_status, embedding_model, description_model = await asyncio.gather(
            self._provider_status(entry, force_health=True),
            self._model_health(self.embedding_client),
            self._model_health(self.description_client),
        )
        return AdminProviderRefreshResponse(
            provider=provider_status,
            embedding_model=embedding_model,
            description_model=description_model,
        )

    async def _provider_status(
        self, entry: ProviderSync, *, force_health: bool
    ) -> ProviderDashboardStatus:
        if entry.scheduler is None or entry.root is None:
            return ProviderDashboardStatus(
                provider=entry.name,
                display_name=entry.display_name,
                enabled=False,
                health="disabled",
                detected_count=None,
                embedded_count=None,
            )

        health_task = asyncio.to_thread(
            entry.health_cache.refresh if force_health else entry.health_cache.get
        )
        detected_task = asyncio.to_thread(self._detected_count, entry)
        embedded_task = asyncio.to_thread(self._embedded_count, entry.name)
        health, detected_count, embedded_count = await asyncio.gather(
            health_task,
            detected_task,
            embedded_task,
        )
        return ProviderDashboardStatus(
            provider=entry.name,
            display_name=entry.display_name,
            enabled=True,
            health=health,
            detected_count=detected_count,
            embedded_count=embedded_count,
        )

    def _detected_count(self, entry: ProviderSync) -> int | None:
        try:
            assert entry.root is not None
            return len(entry.client.list_files(entry.root))
        except Exception:  # noqa: BLE001
            logger.exception("Admin dashboard provider inventory failed")
            return None

    def _embedded_count(self, provider: str) -> int | None:
        try:
            return len(self.qdrant_store.find_all_with_storage_key(provider))
        except Exception:  # noqa: BLE001
            logger.exception("Admin dashboard Qdrant metadata read failed")
            return None

    async def _model_health(self, client: _ModelHealthClient) -> ModelHealthStatus:
        try:
            health = await asyncio.to_thread(client.check_health)
        except Exception:  # noqa: BLE001
            logger.exception("Admin dashboard model health check failed")
            health = "unavailable"
        return ModelHealthStatus(name=client.model_name, health=health)
