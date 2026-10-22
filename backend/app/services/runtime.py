"""Build process-local application dependencies from settings."""

from dataclasses import dataclass

from backend.app.api.routes.health import HealthDependencies
from backend.app.config import Settings
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.model_client import OpenAICompatibleModelClient
from backend.app.integrations.qdrant_store import QdrantEmbeddingStore
from backend.app.model.description_client import InstructorAssetDescriptionClient
from backend.app.model.video_description_client import VideoModelDescriptionClient
from backend.app.storage.registry import ProviderRegistry, build_provider_registry
from backend.app.tag_settings.store import TagSettingsStore


@dataclass(frozen=True)
class RuntimeDependencies:
    """Process-local service graph shared by API and task workers."""

    settings: Settings
    ingestion_service: FileIngestionService
    health_dependencies: HealthDependencies
    provider_registry: ProviderRegistry
    tag_settings_store: TagSettingsStore


def build_runtime_dependencies(settings: Settings) -> RuntimeDependencies:
    """Construct dependencies without retaining module-global clients."""
    description_client = InstructorAssetDescriptionClient(
        endpoint_url=settings.DESCRIPTION_ENDPOINT_URL or "",
        endpoint_api_key=settings.DESCRIPTION_ENDPOINT_API_KEY,
        description_model=settings.DESCRIPTION_MODEL,
        timeout=settings.MODEL_REQUEST_TIMEOUT,
    )
    model_client = OpenAICompatibleModelClient(settings)
    qdrant_store = QdrantEmbeddingStore(settings)
    video_model_client = (
        VideoModelDescriptionClient(
            api_key=settings.VIDEO_MODEL_API_KEY or "",
            model_name=settings.VIDEO_MODEL or "",
        )
        if settings.has_video_model
        else None
    )
    ingestion_service = FileIngestionService(
        asset_description_client=description_client,
        model_client=model_client,
        qdrant_store=qdrant_store,
        settings=settings,
        video_model_client=video_model_client,
    )
    health_dependencies = HealthDependencies(
        description_client=description_client,
        model_client=model_client,
        qdrant_store=qdrant_store,
    )
    return RuntimeDependencies(
        settings=settings,
        ingestion_service=ingestion_service,
        health_dependencies=health_dependencies,
        provider_registry=build_provider_registry(
            settings,
            ingestion_service,
            qdrant_store,
        ),
        tag_settings_store=TagSettingsStore.from_settings(settings),
    )
