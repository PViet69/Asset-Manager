# Admin Session Authentication Design

## Goal

Replace shared `ADMIN_API_KEY` bearer-token access with one environment-configured admin account and signed, HttpOnly browser session cookies.

## Configuration

Remove `ADMIN_API_KEY`. Add required environment variables:

- `ADMIN_USERNAME`: admin login name.
- `ADMIN_PASSWORD_HASH`: Argon2id hash of admin password; never a plaintext password.
- `ADMIN_SESSION_SECRET`: random secret of at least 32 bytes used to sign sessions.

Application startup validates required configuration and fails clearly when missing or invalid.

## HTTP API

Add unauthenticated endpoints:

- `POST /auth/login`: accepts validated username and password; validates credentials; sets session cookie; returns authenticated account metadata.
- `POST /auth/logout`: clears session cookie; returns success response.
- `GET /auth/me`: returns authenticated account metadata when valid session exists; returns 401 otherwise.

Keep admin sync endpoints. Replace bearer-token validation with signed-session validation.

## Session Cookie

On login, server creates signed session containing only admin identity and expiry. Cookie settings:

- `HttpOnly`
- `Secure`
- `SameSite=Strict`
- `Path=/`
- maximum age: 2 hours

Invalid, expired, or tampered cookies receive 401. Logout expires cookie immediately.

## Authorization and CSRF

All admin sync routes require valid admin session. State-changing cookie-authenticated endpoints also enforce same-origin request validation through `Origin` header. Requests without matching configured origin are rejected.

## Frontend

Replace API-key form with username/password login form. On page load, call `/auth/me` to restore session state. API client uses credentialed browser requests and removes Authorization bearer headers. Show logout control and return to login form after logout or an unauthorized response.

## Error Handling

Login failures return generic invalid-credentials response. Do not distinguish unknown username from wrong password. Startup error messages name missing configuration but never reveal passwords, hashes, secrets, or session data.

## Testing

Add or update backend integration tests for valid login, invalid credentials, admin denial without session, acceptance with session, rejection of expired/tampered session, logout, and origin enforcement. Add frontend tests for login, session restore, logout, and unauthorized transition. Existing admin bearer-token tests are removed or updated.

## Non-goals

No self-registration, password reset, multiple accounts, permissions, persistent session storage, or external identity provider.
