"""Request authentication and resource controls."""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime

from fastapi import HTTPException, Request, status

from backend.app.admin_auth import AdminAuthConfig, get_session_username

MAX_REQUEST_SIZE = 250 * 1024 * 1024
RATE_LIMIT_WINDOW_SECONDS = 60
RATE_LIMIT_REQUESTS = 60


@dataclass
class InMemoryRateLimiter:
    """Thread-safe fixed-window request limiter keyed by client address."""

    _requests: dict[str, deque[float]] = field(
        default_factory=lambda: defaultdict(deque)
    )
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def allow(self, key: str, now: float | None = None) -> bool:
        current = time.monotonic() if now is None else now
        cutoff = current - RATE_LIMIT_WINDOW_SECONDS
        with self._lock:
            timestamps = self._requests[key]
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= RATE_LIMIT_REQUESTS:
                return False
            timestamps.append(current)
            return True


def reject_oversized_request(request: Request) -> None:
    """Reject declared request bodies before multipart parsing and spooling."""
    content_length = request.headers.get("content-length")
    if content_length is None:
        return
    try:
        size = int(content_length)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid Content-Length") from None
    if size > MAX_REQUEST_SIZE:
        raise HTTPException(status_code=413, detail="Request exceeds 250 MB limit")


def require_upload_access(request: Request) -> None:
    """Enforce per-client request rate limit."""
    client_key = request.client.host if request.client is not None else "unknown"
    if not request.app.state.upload_rate_limiter.allow(client_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Upload rate limit exceeded",
        )


def require_admin_access(request: Request) -> None:
    """Require valid signed admin session cookie."""
    config: AdminAuthConfig = request.app.state.admin_auth_config
    token = request.cookies.get("admin_session")
    username = get_session_username(config, token, datetime.now(UTC)) if token else None
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )


def require_admin_origin(request: Request) -> None:
    """Require configured browser origin for unsafe admin requests."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return
    config: AdminAuthConfig = request.app.state.admin_auth_config
    if request.headers.get("origin") != config.allowed_origin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid request origin",
        )
