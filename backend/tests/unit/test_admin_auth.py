from datetime import UTC, datetime, timedelta

import pytest
from argon2 import PasswordHasher

from backend.app.admin_auth import (
    AdminAuthConfig,
    create_admin_session,
    get_session_username,
    verify_admin_credentials,
)


def _config() -> AdminAuthConfig:
    return AdminAuthConfig(
        username="admin",
        password_hash=PasswordHasher().hash("correct-password"),
        session_secret="session-secret-for-tests-only",
        allowed_origin="https://admin.example.test",
    )


@pytest.mark.unit
def test_verifies_only_matching_admin_credentials() -> None:
    # Arrange
    config = _config()

    # Act / Assert
    assert verify_admin_credentials(config, "admin", "correct-password") is True
    assert verify_admin_credentials(config, "admin", "wrong-password") is False
    assert verify_admin_credentials(config, "other", "correct-password") is False


@pytest.mark.unit
def test_rejects_expired_or_tampered_session() -> None:
    # Arrange
    config = _config()
    issued_at = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
    token = create_admin_session(config, issued_at)

    # Act / Assert
    assert (
        get_session_username(config, token, issued_at + timedelta(hours=1)) == "admin"
    )
    assert (
        get_session_username(config, token, issued_at + timedelta(hours=2, seconds=1))
        is None
    )
    assert (
        get_session_username(config, f"{token}x", issued_at + timedelta(minutes=1))
        is None
    )
