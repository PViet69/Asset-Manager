from unittest.mock import Mock

import pytest

from backend.app.config import Settings
from backend.app.services import runtime
from backend.app.storage import StorageProvider


def make_settings() -> Settings:
    return Settings(
        _env_file=None,
        MODEL_ENDPOINT_URL="https://model.example",
        DESCRIPTION_MODEL="vision-model",
        DESCRIPTION_ENDPOINT_URL="https://vision.example",
        DESCRIPTION_ENDPOINT_API_KEY="vision-key",
        EMBEDDING_MODEL="embedding-model",
        QDRANT_URL="https://qdrant.example",
        QDRANT_VECTOR_SIZE=2,
        ADMIN_USERNAME="admin",
        ADMIN_PASSWORD_HASH="password-hash",
        ADMIN_SESSION_SECRET="session-secret",
        ADMIN_ALLOWED_ORIGIN="https://admin.example.test",
    )


@pytest.mark.unit
def test_build_runtime_dependencies_reuses_single_qdrant_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = make_settings()
    qdrant = Mock()
    monkeypatch.setattr(runtime, "QdrantEmbeddingStore", lambda _: qdrant)

    dependencies = runtime.build_runtime_dependencies(settings)

    assert dependencies.health_dependencies.qdrant_store is qdrant
    assert dependencies.provider_registry.get(StorageProvider.DROPBOX) is not None
