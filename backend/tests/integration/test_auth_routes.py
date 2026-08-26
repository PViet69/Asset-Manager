"""Integration tests for single-admin authentication routes."""

from unittest.mock import Mock

import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig
from backend.app.file_embeddings.ingestion_service import FileIngestionService
from backend.app.main import create_app

TEST_ORIGIN = "https://admin.example.test"


def _client() -> TestClient:
    app = create_app(
        service=Mock(spec=FileIngestionService),
        admin_auth_config=AdminAuthConfig(
            username="admin",
            password_hash=PasswordHasher().hash("correct-password"),
            session_secret="session-secret-for-tests-only",
            allowed_origin=TEST_ORIGIN,
        ),
    )
    return TestClient(app, base_url="https://testserver")


@pytest.mark.integration
def test_login_sets_secure_session_and_me_restores_account() -> None:
    with _client() as client:
        login = client.post(
            "/auth/login",
            json={"username": "admin", "password": "correct-password"},
            headers={"Origin": TEST_ORIGIN},
        )
        restored = client.get("/auth/me")

    assert login.status_code == 200
    assert login.json() == {"username": "admin"}
    assert "HttpOnly" in login.headers["set-cookie"]
    assert "Secure" in login.headers["set-cookie"]
    assert "SameSite=strict" in login.headers["set-cookie"]
    assert "Max-Age=7200" in login.headers["set-cookie"]
    assert restored.status_code == 200
    assert restored.json() == {"username": "admin"}


@pytest.mark.integration
def test_invalid_login_has_generic_error_and_no_cookie() -> None:
    with _client() as client:
        response = client.post(
            "/auth/login",
            json={"username": "admin", "password": "wrong-password"},
            headers={"Origin": TEST_ORIGIN},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or password"
    assert "set-cookie" not in response.headers


@pytest.mark.integration
def test_login_rejects_wrong_origin() -> None:
    with _client() as client:
        response = client.post(
            "/auth/login",
            json={"username": "admin", "password": "correct-password"},
            headers={"Origin": "https://attacker.example.test"},
        )

    assert response.status_code == 403
    assert response.json()["detail"] == "Invalid request origin"


@pytest.mark.integration
def test_login_rate_limits_sixth_attempt() -> None:
    with _client() as client:
        responses = [
            client.post(
                "/auth/login",
                json={"username": "admin", "password": "wrong-password"},
                headers={"Origin": TEST_ORIGIN},
            )
            for _ in range(6)
        ]

    assert [response.status_code for response in responses] == [401] * 5 + [429]
