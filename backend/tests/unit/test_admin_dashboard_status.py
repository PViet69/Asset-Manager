"""Unit tests for immutable admin dashboard status collection."""

from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from backend.app.admin_dashboard.status_service import AdminDashboardStatusService
from backend.app.exceptions import QdrantStorageError
from backend.app.integrations.qdrant_store import SearchHit
from backend.app.storage.client import StorageFile
from backend.app.storage.registry import ProviderRegistry, ProviderSync


@dataclass
class _Client:
    files: list[StorageFile]
    health: str = "ok"
    list_count: int = 0

    def list_files(self, root: str) -> list[StorageFile]:  # noqa: ARG002
        self.list_count += 1
        return self.files

    def check_health(self) -> str:
        return self.health


@dataclass
class _Qdrant:
    hits: list[SearchHit]
    error: Exception | None = None
    lookup_count: int = 0

    def find_all_with_storage_key(self, provider: str) -> list[SearchHit]:  # noqa: ARG002
        self.lookup_count += 1
        if self.error is not None:
            raise self.error
        return self.hits


@dataclass(frozen=True)
class _Model:
    model_name: str
    health: str

    def check_health(self) -> str:
        return self.health


def _file() -> StorageFile:
    return StorageFile(
        provider="google_drive",
        storage_file_id="file-1",
        name="asset.png",
        mime_type="image/png",
        modified_time=datetime.now(timezone.utc),
        size=1,
    )


def _registry(client: _Client, *, enabled: bool = True) -> ProviderRegistry:
    return ProviderRegistry(
        (
            ProviderSync(
                name="google_drive",
                display_name="Google Drive",
                client=client,
                scheduler=object() if enabled else None,  # type: ignore[arg-type]
                root="root" if enabled else None,
            ),
        )
    )


def _service(
    *,
    client: _Client | None = None,
    qdrant: _Qdrant | None = None,
    enabled: bool = True,
) -> AdminDashboardStatusService:
    return AdminDashboardStatusService(
        registry=_registry(client or _Client([_file()]), enabled=enabled),
        qdrant_store=qdrant or _Qdrant([SearchHit("point-1", 1.0, {})]),
        embedding_client=_Model("embed-v1", "ok"),
        description_client=_Model("describe-v1", "unavailable"),
    )


@pytest.mark.unit
@pytest.mark.asyncio
async def test_status_returns_provider_detected_metadata_counts_and_model_health() -> (
    None
):
    response = await _service().get_status()

    assert response.providers[0].detected_count == 1
    assert response.providers[0].embedded_count == 1
    assert response.embedding_model.name == "embed-v1"
    assert response.embedding_model.health == "ok"
    assert response.description_model.name == "describe-v1"
    assert response.description_model.health == "unavailable"


@pytest.mark.unit
@pytest.mark.asyncio
async def test_status_isolates_qdrant_failure_to_embedded_count() -> None:
    response = await _service(
        qdrant=_Qdrant([], QdrantStorageError("failure"))
    ).get_status()

    assert response.providers[0].detected_count == 1
    assert response.providers[0].embedded_count is None


@pytest.mark.unit
@pytest.mark.asyncio
async def test_disabled_provider_avoids_storage_and_qdrant_reads() -> None:
    client = _Client([_file()])
    qdrant = _Qdrant([SearchHit("point-1", 1.0, {})])

    response = await _service(client=client, qdrant=qdrant, enabled=False).get_status()

    assert response.providers[0].detected_count is None
    assert response.providers[0].embedded_count is None
    assert client.list_count == 0
    assert qdrant.lookup_count == 0


@pytest.mark.unit
@pytest.mark.asyncio
async def test_refresh_rechecks_only_selected_provider_health_and_counts() -> None:
    client = _Client([_file()])
    service = _service(client=client)

    response = await service.refresh_provider("google_drive")

    assert response.provider.health == "ok"
    assert response.provider.detected_count == 1
    assert client.list_count == 1
