"""Integration tests for provider-qualified Qdrant storage."""

from qdrant_client import QdrantClient

from backend.app.integrations.qdrant_store import (
    PAYLOAD_PROVIDER,
    PAYLOAD_STORAGE_FILE_ID,
    QdrantEmbeddingStore,
    stable_point_id,
)


def _store() -> QdrantEmbeddingStore:
    store = QdrantEmbeddingStore.from_client(QdrantClient(":memory:"), 2, "storage-it")
    store.ensure_collection()
    return store


def _payload(provider: str, storage_file_id: str) -> dict[str, str]:
    return {PAYLOAD_PROVIDER: provider, PAYLOAD_STORAGE_FILE_ID: storage_file_id}


def test_storage_key_filter_prevents_cross_provider_id_collisions() -> None:
    store = _store()
    store.store_embedding([0.1, 0.2], _payload("google_drive", "same"))
    store.store_embedding([0.3, 0.4], _payload("dropbox", "same"))
    assert len(store.find_by_storage_key("google_drive", "same")) == 1
    assert len(store.find_by_storage_key("dropbox", "same")) == 1
    assert store.delete_by_storage_key("dropbox", "same") == 1
    assert len(store.find_by_storage_key("google_drive", "same")) == 1


def test_provider_listing_skips_legacy_records() -> None:
    store = _store()
    store.store_embedding([0.1, 0.2], _payload("dropbox", "one"))
    store.store_embedding([0.3, 0.4], {})
    assert [
        hit.payload[PAYLOAD_STORAGE_FILE_ID]
        for hit in store.find_all_with_storage_key("dropbox")
    ] == ["one"]


def test_stable_point_id_is_provider_qualified() -> None:
    assert stable_point_id("dropbox", "same") == stable_point_id("dropbox", "same")
    assert stable_point_id("dropbox", "same") != stable_point_id("google_drive", "same")
