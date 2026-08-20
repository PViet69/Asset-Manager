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
from backend.app.integrations.qdrant_store import QdrantStore, SearchHit
from backend.app.model.description_client import ImageDescriptionClient

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class FileUpload:
    """Immutable uploaded file value."""

    filename: str
    content_type: str
    content: bytes
    file_path: str
    drive_id: str
    modified_time: datetime


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

    def search(self, query: str, limit: int) -> VectorSearchResponse:
        """Search stored vectors by embedded query text."""
        threshold = self._settings.SEARCH_THRESHOLD if self._settings else None
        if threshold is None:
            raise SettingsError("Search is not configured")
        vector = self._model_client.embed_text(query)
        hits = self._qdrant_store.search(vector, limit=limit, score_threshold=threshold)
        items = [
            self._to_search_item(hit) for hit in hits if self._has_full_payload(hit)
        ]
        return VectorSearchResponse(data=items)

    @staticmethod
    def _has_full_payload(hit: SearchHit) -> bool:
        """Points without a complete payload are excluded from results."""
        payload = hit.payload
        return all(
            payload.get(key) is not None
            for key in ("filename", "file_path", "file_type", "content")
        )

    @staticmethod
    def _to_search_item(hit: SearchHit) -> VectorSearchItem:
        payload = hit.payload
        drive_id = payload.get("drive_id")
        source_url = (
            f"https://drive.google.com/file/d/{drive_id}/view"
            if isinstance(drive_id, str) and drive_id
            else None
        )
        return VectorSearchItem(
            point_id=hit.point_id,
            score=hit.score,
            filename=str(payload["filename"]),
            file_path=str(payload["file_path"]),
            file_type=str(payload["file_type"]),
            content=str(payload["content"]),
            source_url=source_url,
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
            if processed.kind == "image":
                payload = {
                    "filename": file.filename,
                    "file_path": file.file_path,
                    "file_type": file.content_type,
                    "content": embedding_text,
                    "drive_id": file.drive_id,
                    "modified_time": file.modified_time.isoformat(),
                }
            self._qdrant_store.store_embedding(vector, payload=payload)
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
        if processed.kind == "text":
            return str(processed.value)
        description = self._description_client.describe(bytes(processed.value))
        return description.to_embedding_text()
