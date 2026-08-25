"""Single-admin credential and signed session helpers."""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TypedDict

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from itsdangerous import BadSignature, URLSafeSerializer

ADMIN_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60
SESSION_SALT = "admin-session-v1"


class _SessionPayload(TypedDict):
    username: str
    expires_at: int


@dataclass(frozen=True)
class AdminAuthConfig:
    """Configuration for single-admin authentication."""

    username: str
    password_hash: str
    session_secret: str
    allowed_origin: str


def verify_admin_credentials(
    config: AdminAuthConfig, username: str, password: str
) -> bool:
    """Return whether supplied credentials match configured admin account."""
    username_matches = hmac.compare_digest(username, config.username)
    try:
        password_matches = PasswordHasher().verify(config.password_hash, password)
    except (InvalidHashError, VerificationError, VerifyMismatchError):
        password_matches = False
    return username_matches and password_matches


def create_admin_session(config: AdminAuthConfig, now: datetime) -> str:
    """Create signed session token valid for configured session duration."""
    expires_at = now.astimezone(UTC) + timedelta(seconds=ADMIN_SESSION_MAX_AGE_SECONDS)
    payload: _SessionPayload = {
        "username": config.username,
        "expires_at": int(expires_at.timestamp()),
    }
    return _serializer(config).dumps(payload)


def get_session_username(
    config: AdminAuthConfig, token: str, now: datetime
) -> str | None:
    """Return configured username from valid unexpired signed session."""
    try:
        payload = _serializer(config).loads(token)
    except BadSignature:
        return None
    if not isinstance(payload, dict):
        return None
    username = payload.get("username")
    expires_at = payload.get("expires_at")
    if not isinstance(username, str) or not isinstance(expires_at, int):
        return None
    if not hmac.compare_digest(username, config.username):
        return None
    if now.astimezone(UTC).timestamp() > expires_at:
        return None
    return username


def _serializer(config: AdminAuthConfig) -> URLSafeSerializer:
    return URLSafeSerializer(config.session_secret, salt=SESSION_SALT)
