from unittest.mock import Mock, call, patch

import pytest

from backend.app.config import Settings
from backend.app.exceptions import QdrantStorageError
from backend.app.tag_settings.store import TagSettingsStore


def make_settings() -> Settings:
    return Settings(
        _env_file=None,
        MODEL_ENDPOINT_URL="https://model.example",
        DESCRIPTION_MODEL="vision-model",
        DESCRIPTION_ENDPOINT_URL="https://vision.example",
        DESCRIPTION_ENDPOINT_API_KEY="vision-key",
        EMBEDDING_MODEL="embedding-model",
        QDRANT_URL="https://qdrant.example",
        QDRANT_API_KEY="qdrant-key",
        QDRANT_COLLECTION="assets",
        QDRANT_VECTOR_SIZE=2,
    )


@pytest.mark.unit
def test_from_settings_uses_asset_collection_and_default_settings_name() -> None:
    client = Mock()
    with patch(
        "backend.app.tag_settings.store.QdrantClient", return_value=client
    ) as qdrant_client:
        store = TagSettingsStore.from_settings(make_settings())

    assert store._client is client
    assert store._asset_collection == "assets"
    assert store._settings_collection == "assets_tag_settings"
    assert store._vector_size == 2
    assert qdrant_client.call_args.kwargs == {
        "url": "https://qdrant.example",
        "api_key": "qdrant-key",
    }


@pytest.mark.unit
def test_discover_and_index_writes_tags_for_every_asset() -> None:
    client = Mock()
    first = Mock(id="asset-1", payload={"content": "Subjects: Laptop"})
    second = Mock(id="asset-2", payload={"content": "Unknown: ignored"})
    client.scroll.side_effect = [([first], "next"), ([second], None)]
    store = TagSettingsStore.from_client(client, "assets", "tag-settings", 2)

    result = store.discover_and_index()

    assert result.indexed_assets == 2
    assert result.tags == ("subject:laptop",)
    assert client.scroll.call_args_list == [
        call(
            collection_name="assets",
            offset=None,
            limit=1_000,
            with_payload=["content"],
            with_vectors=False,
        ),
        call(
            collection_name="assets",
            offset="next",
            limit=1_000,
            with_payload=["content"],
            with_vectors=False,
        ),
    ]
    client.set_payload.assert_has_calls(
        [
            call(
                collection_name="assets",
                payload={"tags": ["subject:laptop"]},
                points=["asset-1"],
                wait=True,
            ),
            call(
                collection_name="assets",
                payload={"tags": []},
                points=["asset-2"],
                wait=True,
            ),
        ]
    )


@pytest.mark.unit
def test_approved_tags_are_empty_when_settings_record_is_absent() -> None:
    client = Mock()
    client.retrieve.return_value = []
    store = TagSettingsStore.from_client(client, "assets", "tag-settings", 2)

    assert store.get_approved_tags() == ()


@pytest.mark.unit
def test_replace_approved_tags_upserts_stable_record() -> None:
    client = Mock()
    store = TagSettingsStore.from_client(client, "assets", "tag-settings", 2)

    saved = store.replace_approved_tags(
        ["color:black", "subject:laptop", "color:black"]
    )

    assert saved == ("color:black", "subject:laptop")
    point = client.upsert.call_args.kwargs["points"][0]
    assert point.payload == {"approved_tags": ["color:black", "subject:laptop"]}
    assert point.vector == [0.0, 0.0]


@pytest.mark.unit
def test_discovery_chains_safe_storage_error() -> None:
    client = Mock()
    failure = RuntimeError("unavailable")
    client.scroll.side_effect = failure
    store = TagSettingsStore.from_client(client, "assets", "tag-settings", 2)

    with pytest.raises(QdrantStorageError) as exc_info:
        store.discover_and_index()

    assert str(exc_info.value) == "Qdrant storage failure"
    assert exc_info.value.__cause__ is failure
