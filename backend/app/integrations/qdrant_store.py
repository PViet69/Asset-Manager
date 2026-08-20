"""Qdrant adapter for storing and searching file embedding vectors."""

import logging
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID, uuid3, uuid4

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    VectorParams,
)

from backend.app.config import Settings
from backend.app.exceptions import QdrantStorageError

logger = logging.getLogger(__name__)

# Fixed UUID namespace for deriving deterministic point ids from Drive ids.
NAMESPACE = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")

PAYLOAD_DRIVE_ID = "drive_id"
PAYLOAD_MODIFIED_TIME = "modified_time"


@dataclass(frozen=True)
class SearchHit:
    """One scored vector search result with its stored payload."""

    point_id: str
    score: float
    payload: dict


class QdrantStore(Protocol):
    """Protocol for Qdrant collection, storage, search, and health operations."""

    def ensure_collection(self) -> None: ...
    def store_embedding(
        self,
        embedding: list[float],
        payload: dict | None = None,
        *,
        point_id: str | None = None,
    ) -> str: ...
    def find_by_drive_id(self, drive_id: str) -> list[SearchHit]: ...
    def find_all_with_drive_id(self) -> list[SearchHit]: ...
    def delete_by_drive_id(self, drive_id: str) -> int: ...
    def delete_by_point_ids(self, point_ids: list[str]) -> int: ...
    def search(
        self, vector: list[float], limit: int, score_threshold: float
    ) -> list[SearchHit]: ...
    def check_health(self) -> str: ...


def stable_point_id(drive_id: str) -> str:
    """Deterministic UUID5-derived point id from a Drive file id.

    Qdrant rejects non-UUID point ids, so we coerce the hash into a valid UUID
    via ``uuid3`` against a fixed namespace.
    """
    return str(uuid3(NAMESPACE, drive_id))


class QdrantEmbeddingStore:
    """Store and search embedding vectors in a configured Qdrant collection."""

    def __init__(self, settings: Settings) -> None:
        self._client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY,
        )
        self._vector_size = settings.QDRANT_VECTOR_SIZE
        self._collection = settings.QDRANT_COLLECTION
        self._distance = Distance(settings.QDRANT_DISTANCE)

    @classmethod
    def from_client(
        cls,
        client: QdrantClient,
        vector_size: int,
        collection: str,
    ) -> "QdrantEmbeddingStore":
        """Construct with a pre-built Qdrant client for testing."""
        instance = cls.__new__(cls)
        instance._client = client
        instance._vector_size = vector_size
        instance._collection = collection
        instance._distance = Distance.COSINE
        return instance

    def ensure_collection(self) -> None:
        """Create configured collection when it does not exist."""
        try:
            if self._client.collection_exists(collection_name=self._collection):
                return
            self._client.create_collection(
                collection_name=self._collection,
                vectors_config=VectorParams(
                    size=self._vector_size,
                    distance=self._distance,
                ),
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant collection operation failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc

    def store_embedding(
        self,
        embedding: list[float],
        payload: dict | None = None,
        *,
        point_id: str | None = None,
    ) -> str:
        """Upsert one embedding point and return its id (random UUID by default).

        Pass ``point_id`` for deterministic ids (e.g. derived from a Drive file id)
        so re-syncing the same file replaces its old vector instead of creating a
        duplicate.
        """
        resolved_id = point_id or str(uuid4())
        try:
            point = PointStruct(id=resolved_id, vector=embedding, payload=payload)
            self._client.upsert(
                collection_name=self._collection,
                points=[point],
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant embedding upsert failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return resolved_id

    def find_by_drive_id(self, drive_id: str) -> list[SearchHit]:
        """Return all stored points whose payload carries ``drive_id``."""
        try:
            response = self._client.scroll(
                collection_name=self._collection,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key=PAYLOAD_DRIVE_ID,
                            match=MatchValue(value=drive_id),
                        )
                    ]
                ),
                limit=10_000,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant scroll failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        points = response[0]
        return [
            SearchHit(
                point_id=str(point.id),
                score=1.0,
                payload=point.payload or {},
            )
            for point in points
        ]

    def find_all_with_drive_id(self) -> list[SearchHit]:
        """Return every stored point that has a ``drive_id`` payload field.

        Qdrant's filter DSL has no "field exists" predicate, so we scroll the
        whole collection (capped) and filter client-side.
        """
        try:
            response = self._client.scroll(
                collection_name=self._collection,
                limit=10_000,
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant scroll failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        points = response[0]
        return [
            SearchHit(
                point_id=str(point.id),
                score=1.0,
                payload=point.payload or {},
            )
            for point in points
            if isinstance(point.payload, dict) and point.payload.get("drive_id")
        ]

    def delete_by_drive_id(self, drive_id: str) -> int:
        """Delete all points whose payload carries ``drive_id``. Returns count."""
        before = len(self.find_by_drive_id(drive_id))
        try:
            self._client.delete(
                collection_name=self._collection,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key=PAYLOAD_DRIVE_ID,
                            match=MatchValue(value=drive_id),
                        )
                    ]
                ),
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant delete failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return before

    def delete_by_point_ids(self, point_ids: list[str]) -> int:
        """Delete specific points by id. Returns the count requested."""
        if not point_ids:
            return 0
        try:
            self._client.delete(
                collection_name=self._collection,
                points_selector=point_ids,
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant delete failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return len(point_ids)

    def search(
        self, vector: list[float], limit: int, score_threshold: float
    ) -> list[SearchHit]:
        """Return top scored points at or above score_threshold."""
        try:
            points = self._client.query_points(
                collection_name=self._collection,
                query=vector,
                limit=limit,
                score_threshold=score_threshold,
            ).points
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant search failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return [
            SearchHit(
                point_id=str(point.id),
                score=point.score,
                payload=point.payload or {},
            )
            for point in points
        ]

    def check_health(self) -> str:
        """Return Qdrant availability without exposing client errors."""
        try:
            self._client.get_collections()
        except Exception:  # noqa: BLE001
            return "unavailable"
        return "ok"
