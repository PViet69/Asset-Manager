"""Integration tests for Qdrant store drive_id filtering."""

from qdrant_client import QdrantClient

from backend.app.integrations.qdrant_store import (
    PAYLOAD_DRIVE_ID,
    QdrantEmbeddingStore,
    stable_point_id,
)


def _store() -> tuple[QdrantEmbeddingStore, QdrantClient]:
    client = QdrantClient(":memory:")
    store = QdrantEmbeddingStore.from_client(
        client, vector_size=2, collection="drive-it"
    )
    store.ensure_collection()
    return store, client


def test_find_by_drive_id_returns_only_matching_points() -> None:
    store, _ = _store()
    store.store_embedding([0.1, 0.2], payload={"drive_id": "a"})
    store.store_embedding([0.3, 0.4], payload={"drive_id": "b"})
    store.store_embedding([0.5, 0.6], payload={"drive_id": "a"})

    hits = store.find_by_drive_id("a")

    assert {hit.payload[PAYLOAD_DRIVE_ID] for hit in hits} == {"a"}
    assert len(hits) == 2


def test_find_all_with_drive_id_skips_legacy_points() -> None:
    store, _ = _store()
    store.store_embedding([0.1, 0.2], payload={"drive_id": "a"})
    store.store_embedding([0.3, 0.4], payload={"drive_id": "b"})
    store.store_embedding([0.5, 0.6], payload={})  # legacy: no drive_id

    hits = store.find_all_with_drive_id()

    assert {hit.payload[PAYLOAD_DRIVE_ID] for hit in hits} == {"a", "b"}


def test_delete_by_drive_id_removes_only_matching_points() -> None:
    store, _ = _store()
    store.store_embedding([0.1, 0.2], payload={"drive_id": "a"})
    store.store_embedding([0.3, 0.4], payload={"drive_id": "b"})

    deleted = store.delete_by_drive_id("a")

    assert deleted == 1
    assert {
        hit.payload[PAYLOAD_DRIVE_ID] for hit in store.find_all_with_drive_id()
    } == {"b"}


def test_delete_by_point_ids_removes_listed_points() -> None:
    store, client = _store()
    pid_a = store.store_embedding([0.1, 0.2], payload={"drive_id": "a"})
    pid_b = store.store_embedding([0.3, 0.4], payload={"drive_id": "b"})

    deleted = store.delete_by_point_ids([pid_a])

    assert deleted == 1
    remaining = client.scroll(collection_name="drive-it", limit=10)[0]
    assert [str(p.id) for p in remaining] == [pid_b]


def test_stable_point_id_is_deterministic_and_unique() -> None:
    a1 = stable_point_id("a")
    a2 = stable_point_id("a")
    b = stable_point_id("b")

    assert a1 == a2
    assert a1 != b


def test_store_embedding_with_explicit_point_id_replaces_existing() -> None:
    store, client = _store()
    pid = stable_point_id("a")
    store.store_embedding([0.1, 0.2], payload={"drive_id": "a"}, point_id=pid)
    store.store_embedding([0.3, 0.4], payload={"drive_id": "a"}, point_id=pid)

    points, _ = client.scroll(collection_name="drive-it", limit=10, with_vectors=True)
    assert len(points) == 1
    assert str(points[0].id) == pid
