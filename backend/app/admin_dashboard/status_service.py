"""Safe provider and model status collection for admin dashboard."""

import asyncio
import logging
from dataclasses import dataclass, field
from time import monotonic
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

STATUS_CACHE_TTL_SECONDS = 10


@dataclass
class _StatusCache:
    response: AdminDashboardStatusResponse | None = None
    expires_at: float = 0.0

    def get(self) -> AdminDashboardStatusResponse | None:
        if self.response is None or self.expires_at <= monotonic():
            return None
        return self.response

    def set(self, response: AdminDashboardStatusResponse) -> None:
        self.response = response
        self.expires_at = monotonic() + STATUS_CACHE_TTL_SECONDS

    def clear(self) -> None:
        self.response = None
        self.expires_at = 0.0


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
    _cache: _StatusCache = field(default_factory=_StatusCache, init=False)

    async def get_status(self) -> AdminDashboardStatusResponse:
        # Return a short-lived cached snapshot to avoid repeated health checks.
        cached_status = self._cache.get()
        if cached_status is not None:
            return cached_status

        provider_tasks = tuple(
            self._provider_status(entry, force_health=False)
            for entry in self.registry.providers
        )
        providers = await asyncio.gather(*provider_tasks)
        embedding_model, description_model = await asyncio.gather(
            self._model_health(self.embedding_client),
            self._model_health(self.description_client),
        )
        status = AdminDashboardStatusResponse(
            providers=list(providers),
            embedding_model=embedding_model,
            description_model=description_model,
        )
        self._cache.set(status)
        return status

    async def refresh_provider(self, provider: str) -> AdminProviderRefreshResponse:
        # Force the following dashboard status request to collect a new snapshot.
        self._cache.clear()
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

        try:
            health = await asyncio.to_thread(
                entry.health_cache.refresh if force_health else entry.health_cache.get
            )
        except Exception:  # noqa: BLE001
            health = "unavailable"

        detected_count: int | None = None
        embedded_count: int | None = None

        if health == "ok":
            detected_task = asyncio.to_thread(self._detected_count, entry)
            embedded_task = asyncio.to_thread(self._embedded_count, entry.name)
            results = await asyncio.gather(
                detected_task,
                embedded_task,
                return_exceptions=True,
            )
            detected_count = results[0] if isinstance(results[0], int) else None
            embedded_count = results[1] if isinstance(results[1], int) else None
        else:
            try:
                res = await asyncio.to_thread(self._embedded_count, entry.name)
                embedded_count = res if isinstance(res, int) else None
            except Exception:  # noqa: BLE001
                embedded_count = None

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
