"""File ingestion orchestration for one shared text embedding space."""

import logging
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from backend.app.api.schemas.file_embeddings import (
    FileEmbeddingItem,
    FileEmbeddingResponse,
)
from backend.app.api.schemas.vector_search import (
    MAX_SEARCH_QUERY_LENGTH,
    VectorSearchItem,
    VectorSearchResponse,
)
from backend.app.config import Settings
from backend.app.exceptions import (
    FileProcessingError,
    ModelEndpointError,
    ModelNotFoundError,
    QdrantStorageError,
    SettingsError,
)
from backend.app.file_processing.service import process_file
from backend.app.file_processing.types import ProcessedInput
from backend.app.integrations.model_client import ModelClient
from backend.app.integrations.qdrant_store import (
    QdrantStore,
    SearchHit,
    stable_point_id,
)
from backend.app.model.description_client import ImageDescriptionClient
from backend.app.storage.thumbnail_service import (
    SUPPORTED_THUMBNAIL_MIME_TYPES,
    IndexedThumbnailSource,
)
from backend.app.tag_settings.parser import parse_content_tags

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FileUpload:
    """Immutable uploaded file value."""

    filename: str
    content_type: str
    content: bytes
    file_path: str
    modified_time: datetime
    provider: str | None = None
    storage_file_id: str | None = None
    source_url: str | None = None

    def __post_init__(self) -> None:
        """Require provider-backed files to carry a complete source identity."""
        source_identity = (self.provider, self.storage_file_id, self.source_url)
        if any(value is None for value in source_identity) and any(
            value is not None for value in source_identity
        ):
            raise ValueError(
                "provider-backed files require provider, storage_file_id, "
                "and source_url"
            )


class FileIngestionService:
    """Convert files to text embeddings, store vectors, and search them."""

    def __init__(
        self,
        description_client: ImageDescriptionClient,
        model_client: ModelClient,
        qdrant_store: QdrantStore,
        settings: Settings | None = None,
    ) -> None:
        self._description_client = description_client
        self._model_client = model_client
        self._qdrant_store = qdrant_store
        self._settings = settings

    @property
    def embedding_model(self) -> str:
        """Return configured embedding model identifier."""
        return self._model_client.model_name

    def process_files(
        self,
        files: Sequence[FileUpload],
    ) -> FileEmbeddingResponse:
        """Ingest files independently while preserving input order."""
        return FileEmbeddingResponse(data=[self._process_one(file) for file in files])

    def startup(self) -> None:
        """Ensure embedding collection exists."""
        self._qdrant_store.ensure_collection()

    def embed_text(self, text: str) -> list[float]:
        """Embed query text without storing it."""
        return self._model_client.embed_text(text)

    def search(
        self,
        query: str,
        limit: int,
        provider: str | None = None,
        mode: str = "semantic",
        tags: list[str] | None = None,
    ) -> VectorSearchResponse:
        query = query.strip()
        if len(query) > MAX_SEARCH_QUERY_LENGTH:
            raise ValueError(
                "Search query exceeds maximum allowed length of "
                f"{MAX_SEARCH_QUERY_LENGTH} characters"
            )
        if mode == "filename":
            hits = self._qdrant_store.find_by_filename(
                query, limit=limit, provider=provider, tags=tags
            )
        else:
            threshold = self._settings.SEARCH_THRESHOLD if self._settings else None
            if threshold is None:
                raise SettingsError("Search is not configured")
            if self._model_client.check_health() == "unavailable":
                raise ModelNotFoundError()
            vector = self._model_client.embed_text(query)
            search_kwargs = {"limit": limit, "score_threshold": threshold}
            if provider is not None:
                search_kwargs["provider"] = provider
            if tags:
                search_kwargs["tags"] = tags
            hits = self._qdrant_store.search(vector, **search_kwargs)
        items = [
            self._to_search_item(hit) for hit in hits if self._has_full_payload(hit)
        ]
        return VectorSearchResponse(data=items)

    def find_indexed_thumbnail_source(
        self, provider: str, storage_file_id: str
    ) -> IndexedThumbnailSource | None:
        """Return matching indexed source metadata for thumbnail authorization."""
        hits = self._qdrant_store.find_by_storage_key(provider, storage_file_id)
        for hit in hits:
            payload = hit.payload
            if (
                payload.get("provider") == provider
                and payload.get("storage_file_id") == storage_file_id
                and isinstance(payload.get("file_type"), str)
                and payload["file_type"]
            ):
                return IndexedThumbnailSource(
                    provider, storage_file_id, payload["file_type"]
                )
        return None

    @staticmethod
    def _has_full_payload(hit: SearchHit) -> bool:
        """Points without a complete payload are excluded from results."""
        payload = hit.payload
        return all(
            payload.get(key) is not None
            for key in ("filename", "file_path", "file_type", "content")
        )

    @staticmethod
    def _thumbnail_url(
        provider: object, storage_file_id: object, file_type: object
    ) -> str | None:
        if (
            not isinstance(provider, str)
            or not provider
            or not isinstance(storage_file_id, str)
            or not storage_file_id
            or not isinstance(file_type, str)
        ):
            return None
        if file_type not in SUPPORTED_THUMBNAIL_MIME_TYPES:
            return None
        return f"/v1/storage/{provider}/{storage_file_id}/thumbnail"

    @staticmethod
    def _to_search_item(hit: SearchHit) -> VectorSearchItem:
        payload = hit.payload
        provider = payload.get("provider")
        storage_file_id = payload.get("storage_file_id")
        source_url = payload.get("source_url")
        modified_time = payload.get("modified_time")
        return VectorSearchItem(
            point_id=hit.point_id,
            score=hit.score,
            filename=str(payload["filename"]),
            file_path=str(payload["file_path"]),
            file_type=str(payload["file_type"]),
            content=str(payload["content"]),
            source_url=str(source_url) if isinstance(source_url, str) else None,
            provider=str(provider) if isinstance(provider, str) and provider else None,
            storage_file_id=(
                str(storage_file_id)
                if isinstance(storage_file_id, str) and storage_file_id
                else None
            ),
            thumbnail_url=FileIngestionService._thumbnail_url(
                provider, storage_file_id, payload["file_type"]
            ),
            modified_time=(
                str(modified_time)
                if isinstance(modified_time, str) and modified_time
                else None
            ),
        )

    def _process_one(self, file: FileUpload) -> FileEmbeddingItem:
        try:
            processed = process_file(
                file.content,
                file.filename,
                file.content_type,
            )
            embedding_text = self._to_embedding_text(processed)
            vector = self._model_client.embed_text(embedding_text)
            payload = None
            point_id = None
            if file.provider is not None and file.storage_file_id is not None:
                payload = {
                    "filename": file.filename,
                    "file_path": file.file_path,
                    "file_type": file.content_type,
                    "content": embedding_text,
                    "tags": list(parse_content_tags(embedding_text)),
                    "modified_time": file.modified_time.isoformat(),
                    "provider": file.provider,
                    "storage_file_id": file.storage_file_id,
                    "source_url": file.source_url,
                }
                point_id = stable_point_id(file.provider, file.storage_file_id)
            if point_id is None:
                self._qdrant_store.store_embedding(vector, payload=payload)
            else:
                self._qdrant_store.store_embedding(
                    vector,
                    payload=payload,
                    point_id=point_id,
                )
        except ModelNotFoundError:
            raise
        except (FileProcessingError, ModelEndpointError, QdrantStorageError) as exc:
            return FileEmbeddingItem(
                filename=file.filename,
                content_type=file.content_type,
                status="failed",
                reason=exc.safe_message,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "Unexpected ingestion failure for %r (%s)",
                file.filename,
                type(exc).__name__,
            )
            return FileEmbeddingItem(
                filename=file.filename,
                content_type=file.content_type,
                status="failed",
                reason="Processing failed",
            )

        return FileEmbeddingItem(
            filename=file.filename,
            content_type=file.content_type,
            status="success",
            reason=None,
        )

    def _to_embedding_text(self, processed: ProcessedInput) -> str:
        """Describe validated image bytes for embedding."""
        return self._description_client.describe(processed.value).to_embedding_text()
