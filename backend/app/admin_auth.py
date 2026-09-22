"""Single-admin credential and signed session helpers."""

from __future__ import annotations

import hmac
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from itsdangerous import BadSignature, URLSafeSerializer

SESSION_SALT = "admin-session-v1"


class _SessionPayload(TypedDict):
    username: str


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
    """Create persistent signed session token for configured administrator."""
    del now
    payload: _SessionPayload = {"username": config.username}
    return _serializer(config).dumps(payload)


def get_session_username(
    config: AdminAuthConfig, token: str, now: datetime
) -> str | None:
    """Return configured username from valid signed session."""
    del now
    try:
        payload = _serializer(config).loads(token)
    except BadSignature:
        return None
    if not isinstance(payload, dict):
        return None
    username = payload.get("username")
    if not isinstance(username, str):
        return None
    if not hmac.compare_digest(username, config.username):
        return None
    return username


def _serializer(config: AdminAuthConfig) -> URLSafeSerializer:
    return URLSafeSerializer(config.session_secret, salt=SESSION_SALT)
