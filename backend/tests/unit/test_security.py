"""Unit tests for request authentication and body size security controls."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from backend.app.admin_auth import AdminAuthConfig, create_admin_session
from backend.app.security import (
    MAX_REQUEST_SIZE,
    AdminLoginRateLimiter,
    reject_oversized_request,
    require_admin_access,
    require_admin_origin,
)


def test_reject_oversized_request_allows_valid_content_length() -> None:
    request = Mock()
    request.headers = {"content-length": "1024"}

    # Should not raise
    reject_oversized_request(request)


def test_reject_oversized_request_allows_missing_content_length() -> None:
    request = Mock()
    request.headers = {}

    # Chunked uploads may omit content-length
    reject_oversized_request(request)


def test_reject_oversized_request_raises_413_when_exceeding_max() -> None:
    request = Mock()
    request.headers = {"content-length": str(MAX_REQUEST_SIZE + 1)}

    with pytest.raises(HTTPException) as exc_info:
        reject_oversized_request(request)

    assert exc_info.value.status_code == 413
    assert "250 MB" in exc_info.value.detail


def test_reject_oversized_request_raises_400_for_invalid_content_length() -> None:
    request = Mock()
    request.headers = {"content-length": "not-a-number"}

    with pytest.raises(HTTPException) as exc_info:
        reject_oversized_request(request)

    assert exc_info.value.status_code == 400
    assert "Invalid Content-Length" in exc_info.value.detail


def _admin_request(cookie: str | None, origin: str | None = None) -> Mock:
    config = AdminAuthConfig(
        username="admin",
        password_hash="unused-in-this-test",
        session_secret="session-secret-for-tests-only",
        allowed_origin="https://admin.example.test",
    )
    request = Mock()
    request.cookies = {} if cookie is None else {"admin_session": cookie}
    request.headers = {} if origin is None else {"origin": origin}
    request.app.state = SimpleNamespace(admin_auth_config=config)
    request.method = "POST"
    return request


@pytest.mark.unit
def test_require_admin_access_accepts_valid_session() -> None:
    request = _admin_request(None)
    request.cookies["admin_session"] = create_admin_session(
        request.app.state.admin_auth_config, datetime.now(UTC)
    )

    require_admin_access(request)


@pytest.mark.unit
def test_require_admin_access_rejects_missing_session() -> None:
    with pytest.raises(HTTPException) as exc_info:
        require_admin_access(_admin_request(None))

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Authentication required"


@pytest.mark.unit
def test_require_admin_origin_rejects_wrong_origin() -> None:
    with pytest.raises(HTTPException) as exc_info:
        require_admin_origin(_admin_request(None, "https://attacker.example.test"))

    assert exc_info.value.status_code == 403
    assert exc_info.value.detail == "Invalid request origin"


@pytest.mark.unit
def test_admin_login_rate_limiter_blocks_sixth_request() -> None:
    limiter = AdminLoginRateLimiter()

    for _ in range(5):
        assert limiter.allow("client-ip-1", now=0) is True

    assert limiter.allow("client-ip-1", now=0) is False
    assert limiter.allow("client-ip-2", now=0) is True
