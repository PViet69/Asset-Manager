"""Unit tests for literal storage provider registry."""

from unittest.mock import Mock, patch

import pytest

from backend.app.config import Settings
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.integrations.qdrant_store import QdrantStore
from backend.app.storage.client import DisabledStorageClient
from backend.app.storage.registry import build_provider_registry


def _settings(**overrides: object) -> Settings:
    values = {
        "MODEL_ENDPOINT_URL": "https://model.example",
        "DESCRIPTION_MODEL": "vision-model",
        "DESCRIPTION_ENDPOINT_URL": "https://vision.example",
        "DESCRIPTION_ENDPOINT_API_KEY": "vision-key",
        "EMBEDDING_MODEL": "embedding-model",
        "QDRANT_URL": "https://qdrant.example",
        "QDRANT_VECTOR_SIZE": 2,
    }
    return Settings(_env_file=None, **(values | overrides))


@pytest.mark.unit
def test_registry_keeps_literal_provider_order_when_unconfigured() -> None:
    registry = build_provider_registry(_settings(), Mock(), Mock())

    assert [(entry.name, entry.display_name) for entry in registry.providers] == [
        ("google_drive", "Google Drive"),
        ("dropbox", "Dropbox"),
    ]
    assert all(entry.scheduler is None for entry in registry.providers)
    assert all(
        isinstance(entry.client, DisabledStorageClient) for entry in registry.providers
    )


@pytest.mark.unit
def test_registry_maps_each_configured_root_to_its_provider_entry() -> None:
    registry = build_provider_registry(
        _settings(DRIVE_FOLDER_ID="folder-1", DROPBOX_ROOT_PATH="/team-assets"),
        Mock(),
        Mock(),
    )

    assert registry.get("google_drive").root == "folder-1"
    assert registry.get("dropbox").root == "/team-assets"


@pytest.mark.unit
def test_registry_enables_each_configured_provider_independently() -> None:
    drive_client = Mock()
    dropbox_client = Mock()
    settings = _settings(
        DRIVE_SERVICE_ACCOUNT_JSON="{}",
        DRIVE_FOLDER_ID="drive-root",
        DROPBOX_APP_KEY="key",
        DROPBOX_APP_SECRET="secret",
        DROPBOX_REFRESH_TOKEN="refresh",
        DROPBOX_ROOT_PATH="/team-assets",
    )

    with (
        patch(
            "backend.app.storage.registry.build_google_drive_client",
            return_value=drive_client,
        ),
        patch(
            "backend.app.storage.registry.build_dropbox_client",
            return_value=dropbox_client,
        ),
    ):
        registry = build_provider_registry(
            settings,
            Mock(spec=FileIngestionService),
            Mock(spec=QdrantStore),
        )

    assert all(entry.scheduler is not None for entry in registry.providers)
    assert registry.get("google_drive") is registry.providers[0]
    assert registry.get("dropbox") is registry.providers[1]
    assert registry.get("unknown") is None
