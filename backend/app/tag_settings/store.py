"""Qdrant indexing and persistence for approved asset tags."""

import logging
from dataclasses import dataclass
from uuid import UUID, uuid3

from qdrant_client import QdrantClient
from qdrant_client.models import Distance, PointStruct, VectorParams

from backend.app.config import Settings
from backend.app.exceptions import QdrantStorageError

logger = logging.getLogger(__name__)
NAMESPACE = UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")
SETTINGS_RECORD_ID = str(uuid3(NAMESPACE, "approved-search-tags"))
APPROVED_TAGS_PAYLOAD_KEY = "approved_tags"
SCROLL_BATCH_SIZE = 1_000


@dataclass(frozen=True)
class TagIndexResult:
    indexed_assets: int
    tags: tuple[str, ...]


class TagSettingsStore:
    """Discover stored asset tags and persist approved tag choices."""

    def __init__(
        self,
        client: QdrantClient,
        asset_collection: str,
        settings_collection: str,
        vector_size: int,
    ) -> None:
        self._client = client
        self._asset_collection = asset_collection
        self._settings_collection = settings_collection
        self._vector_size = vector_size

    @classmethod
    def from_settings(cls, settings: Settings) -> "TagSettingsStore":
        """Build settings storage for configured Qdrant collection."""
        return cls(
            client=QdrantClient(
                url=settings.QDRANT_URL, api_key=settings.QDRANT_API_KEY
            ),
            asset_collection=settings.QDRANT_COLLECTION,
            settings_collection=f"{settings.QDRANT_COLLECTION}_tag_settings",
            vector_size=settings.QDRANT_VECTOR_SIZE,
        )

    @classmethod
    def from_client(
        cls,
        client: QdrantClient,
        asset_collection: str,
        settings_collection: str,
        vector_size: int,
    ) -> "TagSettingsStore":
        return cls(client, asset_collection, settings_collection, vector_size)

    def ensure_collection(self) -> None:
        try:
            if not self._client.collection_exists(self._settings_collection):
                self._client.create_collection(
                    collection_name=self._settings_collection,
                    vectors_config=VectorParams(
                        size=self._vector_size, distance=Distance.COSINE
                    ),
                )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant tag settings collection failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc

    def discover_and_index(self) -> TagIndexResult:
        offset: str | int | None = None
        indexed_assets = 0
        discovered: set[str] = set()
        try:
            while True:
                points, next_offset = self._client.scroll(
                    collection_name=self._asset_collection,
                    offset=offset,
                    limit=SCROLL_BATCH_SIZE,
                    with_payload=["tags"],
                    with_vectors=False,
                )
                for point in points:
                    tags = self._sanitize_tags((point.payload or {}).get("tags"))
                    discovered.update(tags)
                    indexed_assets += 1
                if next_offset is None:
                    break
                offset = next_offset
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant tag discovery failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return TagIndexResult(
            indexed_assets, tuple(sorted(discovered, key=str.casefold))
        )

    def get_approved_tags(self) -> tuple[str, ...]:
        try:
            points = self._client.retrieve(
                collection_name=self._settings_collection,
                ids=[SETTINGS_RECORD_ID],
                with_payload=True,
                with_vectors=False,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant approved tag read failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        if not points:
            return ()
        raw_tags = (points[0].payload or {}).get(APPROVED_TAGS_PAYLOAD_KEY, [])
        return self._sanitize_tags(raw_tags)

    def replace_approved_tags(self, tags: list[str]) -> tuple[str, ...]:
        saved = self._sanitize_tags(tags)
        try:
            self._client.upsert(
                collection_name=self._settings_collection,
                points=[
                    PointStruct(
                        id=SETTINGS_RECORD_ID,
                        vector=[0.0] * self._vector_size,
                        payload={APPROVED_TAGS_PAYLOAD_KEY: list(saved)},
                    )
                ],
                wait=True,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("Qdrant approved tag write failed", exc_info=True)
            raise QdrantStorageError("Qdrant storage failure") from exc
        return saved

    @staticmethod
    def _sanitize_tags(raw_tags: object) -> tuple[str, ...]:
        if not isinstance(raw_tags, list):
            return ()
        return tuple(
            sorted(
                {
                    tag.strip().casefold()
                    for tag in raw_tags
                    if isinstance(tag, str) and tag.strip()
                },
                key=str.casefold,
            )
        )
