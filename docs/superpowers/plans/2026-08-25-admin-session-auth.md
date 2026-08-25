# Admin Session Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace shared admin API-key access with one environment-configured account using 2-hour signed HttpOnly session cookies.

**Architecture:** A focused `admin_auth` service verifies Argon2id credentials and signs expiring session payloads. Auth routes set and clear cookies while dependencies authorize admin routes and validate same-origin requests before state changes. Frontend restores cookie-backed session state, logs in with credentials, and no longer carries a bearer token.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic Settings, `argon2-cffi`, `itsdangerous`, pytest, React 18, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-admin-session-auth-design.md`

## Global Constraints

- Remove `ADMIN_API_KEY` completely; never retain bearer-token fallback.
- Required configuration: `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`, `ADMIN_ALLOWED_ORIGIN`.
- `ADMIN_PASSWORD_HASH` uses Argon2id; never accept or store plaintext password in environment configuration.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, max age 7,200 seconds (2 hours).
- Cookie session payload contains only admin identity and expiration; no password, hash, raw session secret, or authorization header enters a response or browser storage.
- Login errors always return generic `Invalid username or password` response.
- Every POST that uses admin cookie authentication validates request `Origin` against `ADMIN_ALLOWED_ORIGIN`.
- Login endpoint is rate-limited using existing in-memory rate-limiter pattern, with a dedicated login limiter.
- Preserve existing provider-sync behavior and public upload/search API behavior.
- Do not add registration, multiple accounts, password reset, persistent sessions, roles, or external identity providers.
- Run FastAPI client generation only if `scripts/generate-client.sh` exists and generated client code is used by frontend; otherwise document why it does not apply.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `pyproject.toml` | Runtime auth dependencies. |
| `backend/app/config.py` | Required admin account, session, and allowed-origin configuration. |
| `backend/app/security.py` | Reusable login limiter plus session/origin authorization dependencies. |
| `backend/app/admin_auth.py` | Credential verification and signed session creation/parsing. |
| `backend/app/api/schemas/auth.py` | Validated login request and safe public account response DTOs. |
| `backend/app/api/routes/auth.py` | Thin login/logout/current-session routes and cookie operations. |
| `backend/app/main.py` | App state initialization, router registration, state cleanup. |
| `backend/app/api/routes/admin/sync.py` | Use session auth dependency and same-origin protection. |
| `backend/tests/unit/test_admin_auth.py` | Unit tests for Argon2 credential and signed-session behavior. |
| `backend/tests/integration/test_auth_routes.py` | HTTP cookie, logout, login rate-limit, and origin tests. |
| `backend/tests/integration/test_admin_routes.py` | Update sync-route authorization tests from bearer keys to session cookies. |
| `.env.example` | Replace API-key variable with required admin auth variables. |
| `frontend/src/types.ts` | Safe authenticated-account response type. |
| `frontend/src/api/client.ts` | Credentialed login/session/admin request helpers and 401 handling surface. |
| `frontend/src/components/AdminPage.tsx` | Login form, restoring state, logout, provider controls. |
| `frontend/src/components/AdminPage.test.tsx` | Login/session/logout/unauthorized UI coverage. |

### Task 1: Add configuration and auth dependencies

**Files:**
- Modify: `pyproject.toml:5-19`
- Modify: `backend/app/config.py:19-70`
- Modify: `.env.example:1-27`
- Test: `backend/tests/unit/test_config.py`

**Interfaces:**
- Produces `Settings.ADMIN_USERNAME: NonBlankSetting`, `Settings.ADMIN_PASSWORD_HASH: NonBlankSetting`, `Settings.ADMIN_SESSION_SECRET: NonBlankSetting`, `Settings.ADMIN_ALLOWED_ORIGIN: AnyHttpUrl`.
- Produces installed imports: `argon2.PasswordHasher`, `argon2.exceptions.VerifyMismatchError`, `itsdangerous.URLSafeTimedSerializer`, `itsdangerous.BadSignature`, `itsdangerous.SignatureExpired`.
- Consumes no preceding task interfaces.

- [ ] **Step 1: Write failing configuration tests**

```python
import pytest
from pydantic import ValidationError

from backend.app.config import Settings


def test_settings_require_admin_session_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    # Arrange
    monkeypatch.delenv("ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ADMIN_PASSWORD_HASH", raising=False)
    monkeypatch.delenv("ADMIN_SESSION_SECRET", raising=False)
    monkeypatch.delenv("ADMIN_ALLOWED_ORIGIN", raising=False)

    # Act / Assert
    with pytest.raises(ValidationError) as exc_info:
        Settings()

    assert "ADMIN_USERNAME" in str(exc_info.value)
    assert "ADMIN_PASSWORD_HASH" in str(exc_info.value)
    assert "ADMIN_SESSION_SECRET" in str(exc_info.value)
    assert "ADMIN_ALLOWED_ORIGIN" in str(exc_info.value)
```

- [ ] **Step 2: Run failing test**

Run: `uv run pytest backend/tests/unit/test_config.py::test_settings_require_admin_session_configuration -v`

Expected: FAIL because configuration remains optional or test fixture lacks variables.

- [ ] **Step 3: Add minimal dependencies and immutable settings**

Add exact runtime dependencies:

```toml
"argon2-cffi>=23.1.0",
"itsdangerous>=2.2.0",
```

Replace optional `ADMIN_API_KEY` setting with required nonblank admin fields. Use Pydantic types/field constraints to reject whitespace-only username, password hash, or secret. Parse `ADMIN_ALLOWED_ORIGIN` as one normalized origin URL; reject paths, query, and fragment through validator. Keep `Settings` frozen.

Update `.env.example`:

```dotenv
ADMIN_USERNAME=
# Generate with: uv run python -c 'from argon2 import PasswordHasher; print(PasswordHasher().hash("replace-me"))'
ADMIN_PASSWORD_HASH=
# Generate with: uv run python -c 'import secrets; print(secrets.token_urlsafe(48))'
ADMIN_SESSION_SECRET=
# Frontend origin allowed to issue admin state changes.
ADMIN_ALLOWED_ORIGIN=http://localhost:5173
```

Remove `ADMIN_API_KEY=` line. Do not place real credentials in `.env.example`.

- [ ] **Step 4: Run configuration tests and dependency lock update**

Run: `uv lock && uv run pytest backend/tests/unit/test_config.py -v`

Expected: PASS. Lockfile includes `argon2-cffi`, its bindings, and `itsdangerous`.

- [ ] **Step 5: Commit configuration foundation**

```bash
git add pyproject.toml uv.lock backend/app/config.py backend/tests/unit/test_config.py .env.example
git commit -m "feat: configure admin session authentication"
```

### Task 2: Build session service and authorization dependencies

**Files:**
- Create: `backend/app/admin_auth.py`
- Modify: `backend/app/security.py:1-82`
- Test: `backend/tests/unit/test_admin_auth.py`

**Interfaces:**
- Consumes: `Settings.ADMIN_USERNAME`, `Settings.ADMIN_PASSWORD_HASH`, `Settings.ADMIN_SESSION_SECRET`, `Settings.ADMIN_ALLOWED_ORIGIN`.
- Produces `AdminAuthConfig(username: str, password_hash: str, session_secret: str, allowed_origin: str)` frozen dataclass.
- Produces `create_admin_session(config: AdminAuthConfig, now: datetime) -> str`.
- Produces `get_session_username(config: AdminAuthConfig, token: str, now: datetime) -> str | None`.
- Produces `verify_admin_credentials(config: AdminAuthConfig, username: str, password: str) -> bool`.
- Produces FastAPI dependencies `require_admin_access(request: Request) -> None` and `require_admin_origin(request: Request) -> None`.

- [ ] **Step 1: Write failing unit tests for credentials and sessions**

```python
from datetime import UTC, datetime, timedelta

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


def test_verifies_only_matching_admin_credentials() -> None:
    # Arrange
    config = _config()

    # Act / Assert
    assert verify_admin_credentials(config, "admin", "correct-password") is True
    assert verify_admin_credentials(config, "admin", "wrong-password") is False
    assert verify_admin_credentials(config, "other", "correct-password") is False


def test_rejects_expired_or_tampered_session() -> None:
    # Arrange
    config = _config()
    issued_at = datetime(2026, 8, 25, 12, 0, tzinfo=UTC)
    token = create_admin_session(config, issued_at)

    # Act / Assert
    assert get_session_username(config, token, issued_at + timedelta(hours=1)) == "admin"
    assert get_session_username(config, token, issued_at + timedelta(hours=2, seconds=1)) is None
    assert get_session_username(config, f"{token}x", issued_at + timedelta(minutes=1)) is None
```

- [ ] **Step 2: Run failing unit tests**

Run: `uv run pytest backend/tests/unit/test_admin_auth.py -v`

Expected: FAIL with `ModuleNotFoundError: backend.app.admin_auth`.

- [ ] **Step 3: Implement minimal auth service**

Implement frozen `AdminAuthConfig`. Use `PasswordHasher.verify()` and `hmac.compare_digest()` for username equality. Catch Argon2 mismatch/invalid-hash exceptions and return `False` without leaking cause.

Use `URLSafeTimedSerializer(config.session_secret, salt="admin-session-v1")`. Serialize only immutable payload:

```python
{"username": config.username, "issued_at": issued_at.isoformat()}
```

Use `loads(token, max_age=7200)` and reject payloads whose username differs from configured account or whose timestamp is invalid. Do not use `TimedSerializer` timestamp as response data; only return username or `None`.

Update `require_admin_access` to read cookie `admin_session`, load `request.app.state.admin_auth_config`, and raise:

```python
HTTPException(status_code=401, detail="Authentication required")
```

Replace old bearer parsing entirely. Add `require_admin_origin` that permits GET requests, requires `Origin` matching `config.allowed_origin` on unsafe methods, and raises `403` with `Invalid request origin` when absent/mismatched.

Add `AdminLoginRateLimiter` using immutable constants `LOGIN_RATE_LIMIT_WINDOW_SECONDS = 60` and `LOGIN_RATE_LIMIT_REQUESTS = 5`; retain independent per-client state and `allow()` semantics from `InMemoryRateLimiter`.

- [ ] **Step 4: Run unit tests**

Run: `uv run pytest backend/tests/unit/test_admin_auth.py backend/tests/unit/test_security.py -v`

Expected: PASS. Existing upload limiter tests still pass.

- [ ] **Step 5: Commit session core**

```bash
git add backend/app/admin_auth.py backend/app/security.py backend/tests/unit/test_admin_auth.py
git commit -m "feat: add signed admin session service"
```

### Task 3: Add auth HTTP routes and wire app lifecycle

**Files:**
- Create: `backend/app/api/schemas/auth.py`
- Create: `backend/app/api/routes/auth.py`
- Modify: `backend/app/main.py:42-155`
- Test: `backend/tests/integration/test_auth_routes.py`

**Interfaces:**
- Consumes: `AdminAuthConfig`, `verify_admin_credentials`, `create_admin_session`, `get_session_username`, `require_admin_origin`, `AdminLoginRateLimiter` from Task 2.
- Produces `AdminLoginRequest(username: str, password: str)` and `AdminAccountResponse(username: str)` Pydantic DTOs.
- Produces routes `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`.
- Produces app-state keys `admin_auth_config` and `admin_login_rate_limiter`.

- [ ] **Step 1: Write failing integration tests**

```python
import pytest
from argon2 import PasswordHasher
from fastapi.testclient import TestClient

from backend.app.admin_auth import AdminAuthConfig
from backend.app.main import create_app


def _client() -> TestClient:
    app = create_app(
        admin_auth_config=AdminAuthConfig(
            username="admin",
            password_hash=PasswordHasher().hash("correct-password"),
            session_secret="session-secret-for-tests-only",
            allowed_origin="https://admin.example.test",
        )
    )
    return TestClient(app)


@pytest.mark.integration
def test_login_sets_secure_http_only_session_and_me_restores_account() -> None:
    # Arrange
    with _client() as client:
        # Act
        login = client.post(
            "/auth/login",
            json={"username": "admin", "password": "correct-password"},
            headers={"Origin": "https://admin.example.test"},
        )
        restored = client.get("/auth/me")

    # Assert
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
            headers={"Origin": "https://admin.example.test"},
        )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid username or password"
    assert "set-cookie" not in response.headers
```

Add tests in same file for unauthenticated `/auth/me` (401), logout clearing cookie, invalid login origin (403), and sixth invalid login from same client in one minute (429).

- [ ] **Step 2: Run failing route tests**

Run: `uv run pytest backend/tests/integration/test_auth_routes.py -v`

Expected: FAIL with 404 because auth router does not exist.

- [ ] **Step 3: Create DTOs, thin routes, and lifecycle wiring**

Create immutable Pydantic models:

```python
class AdminLoginRequest(BaseModel):
    model_config = ConfigDict(frozen=True)
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=1, max_length=256)

class AdminAccountResponse(BaseModel):
    model_config = ConfigDict(frozen=True)
    username: str
```

Build `/auth` router. Login must call origin dependency, then rate limiter, then credential service. Set cookie only after success:

```python
response.set_cookie(
    key="admin_session",
    value=token,
    max_age=7200,
    httponly=True,
    secure=True,
    samesite="strict",
    path="/",
)
```

Logout must require same origin, call `response.delete_cookie(key="admin_session", path="/", httponly=True, secure=True, samesite="strict")`, and return `AdminAccountResponse` only when active session validated; otherwise return `204` without exposing session status. Chosen implementation: make logout idempotent `204 No Content`, no response schema. `/auth/me` uses `require_admin_access` and returns safe account metadata.

In `create_app`, replace `admin_api_key` parameter with `admin_auth_config: AdminAuthConfig | None`. When normal startup loads settings, construct config from required settings. Initialize `application.state.admin_auth_config` and dedicated login limiter. Register auth router. Remove `admin_api_key` state setup and cleanup fully. Ensure test-injected services can pass explicit `AdminAuthConfig` without constructing `Settings`.

- [ ] **Step 4: Run integration tests**

Run: `uv run pytest backend/tests/integration/test_auth_routes.py backend/tests/unit/test_bootstrap.py -v`

Expected: PASS.

- [ ] **Step 5: Commit auth HTTP surface**

```bash
git add backend/app/api/schemas/auth.py backend/app/api/routes/auth.py backend/app/main.py backend/tests/integration/test_auth_routes.py
git commit -m "feat: add admin login session routes"
```

### Task 4: Protect sync routes using session and origin checks

**Files:**
- Modify: `backend/app/api/routes/admin/sync.py:1-98`
- Modify: `backend/tests/integration/test_admin_routes.py:1-146`

**Interfaces:**
- Consumes `require_admin_access` and `require_admin_origin` from Task 2; `AdminAuthConfig` and `/auth/login` from Task 3.
- Produces session-only access for `POST /admin/sync/{provider}`, `GET /admin/sync/status`, and `POST /admin/sync/{provider}/reindex/{storage_file_id}`.

- [ ] **Step 1: Replace bearer-token test setup with login helper**

Update fixture factory to inject `AdminAuthConfig` and add helper:

```python
def _login(client: TestClient) -> None:
    response = client.post(
        "/auth/login",
        json={"username": "admin", "password": "correct-password"},
        headers={"Origin": "https://admin.example.test"},
    )
    assert response.status_code == 200
```

Replace bearer-key tests with explicit cases:

```python
@pytest.mark.integration
def test_admin_sync_requires_session() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry)) as client:
        response = client.post(
            "/admin/sync/dropbox",
            headers={"Origin": "https://admin.example.test"},
        )
    assert response.status_code == 401


@pytest.mark.integration
def test_admin_sync_rejects_cross_origin_session_request() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry)) as client:
        _login(client)
        response = client.post(
            "/admin/sync/dropbox",
            headers={"Origin": "https://attacker.example.test"},
        )
    assert response.status_code == 403
```

Update valid status/sync/reindex tests to call `_login(client)`. Remove every `Authorization` header.

- [ ] **Step 2: Run failing admin-route tests**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py -v`

Expected: FAIL because routes still only require old bearer-key dependency.

- [ ] **Step 3: Wire authorization dependencies to routes**

Keep `require_admin_access` on all sync routes. Add `Depends(require_admin_origin)` only to POST sync/reindex endpoints. Leave GET status requiring session but not Origin. Do not alter provider lookup, scheduler selection, response schemas, or sync behavior.

- [ ] **Step 4: Run admin integration tests**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py -v`

Expected: PASS. No test sends `Authorization: Bearer`.

- [ ] **Step 5: Commit session route protection**

```bash
git add backend/app/api/routes/admin/sync.py backend/tests/integration/test_admin_routes.py
git commit -m "feat: protect admin sync with sessions"
```

### Task 5: Replace API-key frontend flow with browser session flow

**Files:**
- Modify: `frontend/src/types.ts:35-66`
- Modify: `frontend/src/api/client.ts:1-90`
- Modify: `frontend/src/components/AdminPage.tsx:1-114`
- Modify: `frontend/src/components/AdminPage.test.tsx:1-75`

**Interfaces:**
- Consumes backend DTO `AdminAccountResponse` from Task 3 and cookie session behavior from Task 4.
- Produces frontend type `AdminAccount = { username: string }`.
- Produces API functions `loginAdmin(username: string, password: string): Promise<AdminAccount>`, `getAdminSession(): Promise<AdminAccount>`, `logoutAdmin(): Promise<void>`, `getAdminSyncStatus(): Promise<AdminSyncStatusResponse>`, and `triggerAdminSync(provider: string): Promise<AdminSyncResponse>`.

- [ ] **Step 1: Write failing frontend tests**

Replace existing key-form test with these focused cases; mock `getAdminSession`, `loginAdmin`, `logoutAdmin`, `getAdminSyncStatus`, and `triggerAdminSync`:

```tsx
test("logs in then loads provider status", async () => {
  // Arrange
  mockedGetAdminSession.mockRejectedValue(new ApiError(401, "Authentication required"));
  mockedLoginAdmin.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({ providers: [] });
  render(<AdminPage />);

  // Act
  await userEvent.type(screen.getByLabelText("Username"), "admin");
  await userEvent.type(screen.getByLabelText("Password"), "correct-password");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

  // Assert
  expect(mockedLoginAdmin).toHaveBeenCalledWith("admin", "correct-password");
  expect(mockedGetAdminSyncStatus).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("restores session on page load", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({ providers: [] });
  render(<AdminPage />);

  expect(await screen.findByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("returns to login when an admin request returns 401", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockRejectedValue(new ApiError(401, "Authentication required"));
  render(<AdminPage />);

  expect(await screen.findByLabelText("Username")).toBeInTheDocument();
});
```

Add logout test verifying `logoutAdmin()` call and login form restoration. Retain existing provider activity rendering assertions after successful session restore.

- [ ] **Step 2: Run failing frontend test**

Run: `npm --prefix frontend test -- AdminPage.test.tsx --run`

Expected: FAIL because functions and login UI do not exist.

- [ ] **Step 3: Implement credentialed API helpers**

Add `credentials: "include"` to every auth/admin `fetch`. Keep existing public API header behavior unchanged. Implement auth API calls with typed JSON and no authorization header:

```ts
export function loginAdmin(username: string, password: string): Promise<AdminAccount> {
  return postJson("/auth/login", { username, password }, { credentials: "include" });
}
```

Refactor `postJson` only enough to accept immutable `RequestInit` options and preserve current callers. Implement logout with POST and `credentials: "include"`; expose `void` after checking HTTP status. Implement `getAdminSession` with credentialed GET. Remove `adminRequest`, all `adminApiKey` parameters, and all bearer header creation for admin paths.

- [ ] **Step 4: Implement login/session UI**

Replace `adminApiKey` and `activeKey` state with `username`, `password`, and `isAuthenticated`. Use `useEffect` to call `getAdminSession()` once at mount; if successful, set authenticated state and load providers. Treat 401 as signed out; surface other errors in existing error banner.

Login form labels must be `Username` and `Password`; password input uses `type="password"`; submit button text is `Sign in`. On successful login, clear password immutably, set authenticated state, then load providers. On `ApiError` 401 during status/sync calls, clear provider/auth state and return to sign-in UI. Header gets `Sign out` button while authenticated; click awaits `logoutAdmin()`, clears local UI state, and returns sign-in form. Do not place passwords or session values in localStorage, sessionStorage, URL, React props, logs, or error text.

- [ ] **Step 5: Run frontend tests and static checks**

Run: `npm --prefix frontend test -- AdminPage.test.tsx --run && npm --prefix frontend run typecheck && npm --prefix frontend run build`

Expected: PASS.

- [ ] **Step 6: Commit browser session UI**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/AdminPage.tsx frontend/src/components/AdminPage.test.tsx
git commit -m "feat: replace admin key form with login session"
```

### Task 6: Run full verification and security checks

**Files:**
- Modify only if verification reveals defect: relevant production and test files from Tasks 1-5.

**Interfaces:**
- Consumes all completed session-auth interfaces.
- Produces verified account-based admin access with no API-key references.

- [ ] **Step 1: Verify API-key removal**

Run:

```bash
git grep -n "ADMIN_API_KEY\|admin_api_key\|Admin API key\|Bearer admin-secret"
```

Expected: no matches. If a migration note deliberately mentions the old key, keep only documentation reference and exclude secrets; no runtime/config/frontend/test implementation may reference it.

- [ ] **Step 2: Format, lint, and run backend suite with coverage**

Run:

```bash
uv run ruff format backend/app backend/tests
uv run ruff check --select I --fix backend/app backend/tests
uv run ruff check backend/app backend/tests
uv run pytest --cov=backend/app --cov-report=term-missing
```

Expected: formatter clean, lint clean, all tests pass, and line coverage is at least 80%.

- [ ] **Step 3: Run frontend suite and build**

Run:

```bash
npm --prefix frontend test -- --run
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

Expected: all pass.

- [ ] **Step 4: Inspect credential and cookie exposure**

Run:

```bash
git diff --check
git grep -nE "ADMIN_PASSWORD=|ADMIN_SESSION_SECRET=[^$]|password_hash.*response|Authorization:.*admin"
```

Expected: no plaintext admin password, no concrete session secret, no password hash response, and no admin Authorization header. Review login error strings to confirm username/password failure remains indistinguishable.

- [ ] **Step 5: Run application-level smoke test**

Run backend locally with test-only environment values, then verify in browser or HTTP client:

1. `/auth/me` without cookie returns 401.
2. Valid login returns secure, HttpOnly, strict cookie with two-hour max age.
3. Cookie-authenticated `GET /admin/sync/status` succeeds.
4. Cookie-authenticated cross-origin `POST /admin/sync/dropbox` returns 403.
5. Logout clears cookie; next `/auth/me` returns 401.

Do not use production credentials in command history, source files, screenshots, or test fixtures.

- [ ] **Step 6: Commit verification fixes only if needed**

```bash
git add <only-files-fixed-during-verification>
git commit -m "test: verify admin session authentication"
```

If no changes were necessary, do not create an empty commit.
