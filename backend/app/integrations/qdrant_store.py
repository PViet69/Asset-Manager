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
    MatchAny,
    MatchValue,
    PointStruct,
    VectorParams,
)

from backend.app.config import Settings
from backend.app.exceptions import QdrantStorageError

logger = logging.getLogger(__name__)
NAMESPACE = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
PAYLOAD_PROVIDER = "provider"
PAYLOAD_STORAGE_FILE_ID = "storage_file_id"
PAYLOAD_MODIFIED_TIME = "modified_time"


@dataclass(frozen=True)
class SearchHit:
    point_id: str
    score: float
    payload: dict


class QdrantStore(Protocol):
    def ensure_collection(self) -> None: ...
    def store_embedding(
        self,
        embedding: list[float],
        payload: dict | None = None,
        *,
        point_id: str | None = None,
    ) -> str: ...
    def find_by_storage_key(
        self, provider: str, storage_file_id: str
    ) -> list[SearchHit]: ...
    def find_all_with_storage_key(self, provider: str) -> list[SearchHit]: ...
    def delete_by_storage_key(self, provider: str, storage_file_id: str) -> int: ...
    def delete_by_point_ids(self, point_ids: list[str]) -> int: ...
    def search(
        self,
        vector: list[float],
        limit: int,
        score_threshold: float,
        provider: str | None = None,
    ) -> list[SearchHit]: ...
    def find_by_filename(
        self,
        filename_query: str,
        limit: int,
        provider: str | None = None,
    ) -> list[SearchHit]: ...
    def find_by_tags(
        self,
        tags: list[str],
        limit: int,
        provider: str | None = None,
    ) -> list[SearchHit]: ...
    def check_health(self) -> str: ...


def stable_point_id(provider: str, storage_file_id: str) -> str:
    return str(uuid3(NAMESPACE, f"{provider}:{storage_file_id}"))


class QdrantEmbeddingStore:
    def __init__(self, settings: Settings) -> None:
        self._client = QdrantClient(
            url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY
        )
        self._vector_size = settings.QDRANT_VECTOR_SIZE
        self._collection = settings.QDRANT_COLLECTION
        self._distance = Distance(settings.QDRANT_DISTANCE)

    @classmethod
    def from_client(
        cls, client: QdrantClient, vector_size: int, collection: str
    ) -> "QdrantEmbeddingStore":
        instance = cls.__new__(cls)
        instance._client = client
        instance._vector_size = vector_size
        instance._collection = collection
        instance._distance = Distance.COSINE
        return instance

    def ensure_collection(self) -> None:
        try:
            if not self._client.collection_exists(collection_name=self._collection):
                self._client.create_collection(
                    collection_name=self._collection,
                    vectors_config=VectorParams(
                        size=self._vector_size, distance=self._distance
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
        resolved_id = point_id or str(uuid4())
        try:
            self._client.upsert(
                collection_name=self._collection,
                points=[PointStruct(id=resolved_id, vector=embedding, payload=payload)],
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant embedding upsert failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return resolved_id

    def _key_filter(self, provider: str, storage_file_id: str | None = None) -> Filter:
        conditions = [
            FieldCondition(key=PAYLOAD_PROVIDER, match=MatchValue(value=provider))
        ]
        if storage_file_id is not None:
            conditions.append(
                FieldCondition(
                    key=PAYLOAD_STORAGE_FILE_ID, match=MatchValue(value=storage_file_id)
                )
            )
        return Filter(must=conditions)

    def _scroll(self, filter_: Filter | None = None) -> list[SearchHit]:
        try:
            points = self._client.scroll(
                collection_name=self._collection,
                scroll_filter=filter_,
                limit=10_000,
                with_payload=True,
                with_vectors=False,
            )[0]
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant scroll failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return [SearchHit(str(point.id), 1.0, point.payload or {}) for point in points]

    def find_by_filename(
        self,
        filename_query: str,
        limit: int,
        provider: str | None = None,
    ) -> list[SearchHit]:
        filter_ = self._key_filter(provider) if provider is not None else None
        hits = self._scroll(filter_)
        q = filename_query.lower()
        matched = [
            hit
            for hit in hits
            if isinstance(hit.payload.get("filename"), str)
            and q in hit.payload["filename"].lower()
        ]
        return matched[:limit]

    def find_by_tags(
        self,
        tags: list[str],
        limit: int,
        provider: str | None = None,
    ) -> list[SearchHit]:
        conditions = [
            FieldCondition(key="tags", match=MatchAny(any=[tag])) for tag in tags
        ]
        if provider is not None:
            conditions.append(
                FieldCondition(key=PAYLOAD_PROVIDER, match=MatchValue(value=provider))
            )
        return self._scroll(Filter(must=conditions))[:limit]

    def find_by_storage_key(
        self, provider: str, storage_file_id: str
    ) -> list[SearchHit]:
        return self._scroll(self._key_filter(provider, storage_file_id))

    def find_all_with_storage_key(self, provider: str) -> list[SearchHit]:
        return self._scroll(self._key_filter(provider))

    def delete_by_storage_key(self, provider: str, storage_file_id: str) -> int:
        before = len(self.find_by_storage_key(provider, storage_file_id))
        try:
            self._client.delete(
                collection_name=self._collection,
                points_selector=self._key_filter(provider, storage_file_id),
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant delete failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return before

    def delete_by_point_ids(self, point_ids: list[str]) -> int:
        if not point_ids:
            return 0
        try:
            self._client.delete(
                collection_name=self._collection, points_selector=point_ids, wait=True
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant delete failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return len(point_ids)

    def search(
        self,
        vector: list[float],
        limit: int,
        score_threshold: float,
        provider: str | None = None,
    ) -> list[SearchHit]:
        query = {
            "collection_name": self._collection,
            "query": vector,
            "limit": limit,
            "score_threshold": score_threshold,
        }
        if provider is not None:
            query["query_filter"] = self._key_filter(provider)
        try:
            points = self._client.query_points(**query).points
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant search failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return [
            SearchHit(str(point.id), point.score, point.payload or {})
            for point in points
        ]

    def check_health(self) -> str:
        try:
            self._client.get_collections()
        except Exception:  # noqa: BLE001
            return "unavailable"
        return "ok"
