"""Single-admin browser session authentication routes."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from backend.app.admin_auth import (
    create_admin_session,
    get_session_username,
    verify_admin_credentials,
)
from backend.app.api.schemas.auth import AdminAccountResponse, AdminLoginRequest
from backend.app.security import require_admin_access, require_admin_origin

ADMIN_SESSION_COOKIE = "admin_session"
ADMIN_SESSION_MAX_AGE_SECONDS = 2 * 60 * 60

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/login",
    response_model=AdminAccountResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_origin)],
)
def login(
    payload: AdminLoginRequest, request: Request, response: Response
) -> AdminAccountResponse:
    """Authenticate configured administrator and create browser session."""
    config = request.app.state.admin_auth_config
    if not verify_admin_credentials(config, payload.username, payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=create_admin_session(config, datetime.now(UTC)),
        max_age=ADMIN_SESSION_MAX_AGE_SECONDS,
        httponly=True,
        secure=True,
        samesite="strict",
        path="/",
    )
    return AdminAccountResponse(username=config.username)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin_origin)],
)
def logout(response: Response) -> None:
    """Clear browser admin session cookie."""
    response.delete_cookie(
        key=ADMIN_SESSION_COOKIE,
        path="/",
        httponly=True,
        secure=True,
        samesite="strict",
    )


@router.get(
    "/me",
    response_model=AdminAccountResponse,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_admin_access)],
)
def current_admin(request: Request) -> AdminAccountResponse:
    """Return current authenticated administrator identity."""
    config = request.app.state.admin_auth_config
    token = request.cookies[ADMIN_SESSION_COOKIE]
    username = get_session_username(config, token, datetime.now(UTC))
    assert username is not None
    return AdminAccountResponse(username=username)
