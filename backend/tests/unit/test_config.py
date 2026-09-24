import pytest
from pydantic import ValidationError

from backend.app.config import Settings

BASE_SETTINGS = {
    "MODEL_ENDPOINT_URL": "https://model.example",
    "DESCRIPTION_MODEL": "vision-model",
    "DESCRIPTION_ENDPOINT_URL": "https://vision.example",
    "DESCRIPTION_ENDPOINT_API_KEY": "vision-key",
    "EMBEDDING_MODEL": "embedding-model",
    "QDRANT_URL": "https://qdrant.example",
    "QDRANT_VECTOR_SIZE": 2,
    "ADMIN_USERNAME": "admin",
    "ADMIN_PASSWORD_HASH": "password-hash",
    "ADMIN_SESSION_SECRET": "session-secret",
    "ADMIN_ALLOWED_ORIGIN": "https://admin.example.test",
}


@pytest.mark.unit
def test_settings_require_admin_session_configuration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Arrange
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("ADMIN_SESSION_SECRET", raising=False)
    monkeypatch.delenv("ADMIN_ALLOWED_ORIGIN", raising=False)

    # Act / Assert
    with pytest.raises(ValidationError) as exc_info:
        Settings(_env_file=None)

    assert "ADMIN_USERNAME" in str(exc_info.value)
    assert "ADMIN_PASSWORD_HASH" in str(exc_info.value)
    assert "ADMIN_SESSION_SECRET" in str(exc_info.value)
    assert "ADMIN_ALLOWED_ORIGIN" in str(exc_info.value)


@pytest.mark.unit
@pytest.mark.parametrize(
    "overrides",
    (
        {"VIDEO_MODEL": "gemini-3.8-flash"},
        {"VIDEO_MODEL_API_KEY": "video-key"},
    ),
)
def test_settings_reject_partial_video_model_configuration(
    overrides: dict[str, str],
) -> None:
    with pytest.raises(ValidationError, match="VIDEO_MODEL and VIDEO_MODEL_API_KEY"):
        Settings(_env_file=None, **(BASE_SETTINGS | overrides))


@pytest.mark.unit
def test_settings_reports_video_model_capability_when_pair_is_configured() -> None:
    settings = Settings(
        _env_file=None,
        **(
            BASE_SETTINGS
            | {
                "VIDEO_MODEL": "gemini-3.8-flash",
                "VIDEO_MODEL_API_KEY": "video-key",
            }
        ),
    )

    assert settings.has_video_model is True


@pytest.mark.unit
def test_settings_reject_admin_allowed_origin_with_path() -> None:
    with pytest.raises(ValidationError, match="ADMIN_ALLOWED_ORIGIN must be an origin"):
        Settings(
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
            ADMIN_ALLOWED_ORIGIN="https://admin.example.test/admin",
        )
