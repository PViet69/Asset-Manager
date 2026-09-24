# OpenAI-Compatible File Embeddings

FastAPI service that embeds manually uploaded images and provider-synced images or videos for semantic search. Images use a configurable vision-language model; provider videos use configurable Google Gen AI Files API model. Both produce shared structured `ImageDescription` text, embed through configured text-embedding model, and store vectors in Qdrant. Points store filename, MIME type, and description text. Raw vectors never return.

## Pipeline at a glance

```
manual image upload ─▶ byte-level image detection ─▶ structured description ─▶ formatted text ─▶ text embedding ─▶ Qdrant
provider image sync ─▶ download to RAM ─▶ structured description ─▶ formatted text ─▶ text embedding ─▶ Qdrant
provider video sync ─▶ download to RAM ─▶ Google Gen AI Files API ─▶ structured description ─▶ formatted text ─▶ text embedding ─▶ Qdrant
```

- Images (PNG/JPEG/WEBP) use `DESCRIPTION_MODEL` via Instructor JSON mode and validate into Pydantic `ImageDescription`.
- Provider videos (MP4/MOV/WebM) upload temporary in-memory bytes to configured `VIDEO_MODEL`, wait for processing, then validate output into same `ImageDescription`. Unlike images, whole-video analysis requires Google Gen AI Files API because video can be up to 200 MiB and needs Google-side media preparation; a base64 inline request would be roughly 33% larger and can exceed request or processing limits. Temporary Google Gen AI file deletes after each attempt.
- Both descriptions convert into deterministic multi-section text, then embed through `EMBEDDING_MODEL` into one shared collection.
- Manual `/v1/file-embeddings` uploads remain image-only; video support runs only during Google Drive or Dropbox sync.

## Local development

Prerequisites:

- Python 3.11 or newer
- `uv`
- `libmagic`
- Running Qdrant instance
- Running OpenAI-compatible endpoint that exposes both the vision-language model (`DESCRIPTION_MODEL`) and the text-embedding model (`EMBEDDING_MODEL`)

Install dependencies and copy configuration:

```bash
uv sync --extra dev
cp .env.example .env
```

Set `MODEL_ENDPOINT_URL`, `DESCRIPTION_MODEL`, `EMBEDDING_MODEL`, `QDRANT_URL`, and `QDRANT_VECTOR_SIZE`. Start the app:

```bash
uv run uvicorn backend.app.main:create_app --factory --reload
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MODEL_ENDPOINT_URL` | Yes | None | OpenAI-compatible base URL for the text-embedding model. |
| `MODEL_ENDPOINT_API_KEY` | No | Empty | Embedding endpoint API key. |
| `MODEL_REQUEST_TIMEOUT` | No | `30` | Model request timeout in seconds. |
| `DESCRIPTION_MODEL` | Yes | None | Vision-language model used to generate structured image descriptions (PNG/JPEG/WEBP). |
| `DESCRIPTION_ENDPOINT_URL` | Yes | None | OpenAI-compatible base URL for the description model. May differ from `MODEL_ENDPOINT_URL`. |
| `DESCRIPTION_ENDPOINT_API_KEY` | No | Empty | Description endpoint API key. |
| `VIDEO_MODEL` | No* | None | Google Gen AI model used only for provider-synced MP4, MOV, and WebM descriptions. Must be configured with `VIDEO_MODEL_API_KEY`. |
| `VIDEO_MODEL_API_KEY` | No* | Empty | Google Gen AI API key for `VIDEO_MODEL`. Must be configured with `VIDEO_MODEL`. |
| `EMBEDDING_MODEL` | Yes | None | Text-embedding model used for asset description text. |
| `ADMIN_USERNAME` | Yes | None | Username for sole administrator account. |
| `ADMIN_PASSWORD_HASH` | Yes | None | Argon2id hash for administrator password. |
| `ADMIN_SESSION_SECRET` | Yes | None | Secret used to sign administrator session cookies. |
| `ADMIN_ALLOWED_ORIGIN` | Yes | `http://localhost:5173` | Exact frontend origin permitted to log in and issue admin changes. |
| `QDRANT_URL` | Yes | None | Qdrant URL. |
| `QDRANT_API_KEY` | No | Empty | Qdrant API key. |
| `QDRANT_COLLECTION` | No | `file_embeddings` | Qdrant collection name. |
| `QDRANT_VECTOR_SIZE` | Yes | None | Vector size; must match `EMBEDDING_MODEL` output. |
| `QDRANT_DISTANCE` | No | `Cosine` | Qdrant distance metric used when creating the collection. |
| `SEARCH_THRESHOLD` | No | None | Minimum cosine similarity (0–1) for `/v1/search` hits. Search is unavailable when unset. |
| `DRIVE_SERVICE_ACCOUNT_JSON` | No | Empty | Google Drive service-account JSON. Configure with `DRIVE_FOLDER_ID` to enable manual Drive sync. |
| `DRIVE_FOLDER_ID` | No | Empty | Google Drive source folder ID. |
| `DROPBOX_APP_KEY` | No | Empty | Dropbox app key. Configure all Dropbox values to enable manual Dropbox sync. |
| `DROPBOX_APP_SECRET` | No | Empty | Dropbox app secret. |
| `DROPBOX_REFRESH_TOKEN` | No | Empty | Dropbox offline refresh token. |
| `DROPBOX_ROOT_PATH` | No | Empty | Dropbox source folder path, such as `/team-assets`. |

`VIDEO_MODEL` and `VIDEO_MODEL_API_KEY` are optional together. Set neither to disable provider-video embedding; setting only one prevents startup. Video processing has no model default.

Google Drive and Dropbox are registered in backend code. Configure each source independently; no `STORAGE_PROVIDER` selector exists, and no sync runs until administrator selects provider in `/admin`. Sync recognizes provider MIME metadata for Drive and `.mp4`, `.mov`, or `.webm` extensions for Dropbox. Provider videos over 200 MiB reject before download; no duration limit applies.

At startup, the app checks the configured Qdrant collection and creates it when missing using the configured vector size and distance metric.

## Docker Compose

Docker Desktop with Compose can run the app, the frontend UI, and Qdrant:

```bash
cp .env.example .env
docker compose up --build
```

The UI is served at `http://localhost:${FRONTEND_PORT:-5173}/`; nginx serves the Vite bundle, routes `/admin` to that SPA, and reverse-proxies `/v1`, `/health`, and `/admin/sync/` to the app container. The browser stays same-origin, so no CORS configuration is needed.

When the model API runs on the Docker Desktop host, set `MODEL_ENDPOINT_URL=http://host.docker.internal:8001/v1`. In other environments, use a URL reachable from the app container. Compose connects the app to Qdrant using service DNS.

`docker compose down` preserves the named `qdrant_storage` volume. `docker compose down -v` deletes local Qdrant data.

## Create file embeddings

`POST /v1/file-embeddings` accepts multipart form data with repeated `files` fields:

```bash
curl -X POST http://localhost:8000/v1/file-embeddings \
  -F files=@photo.png
```

The response contains one result per uploaded file:

```json
{
  "object": "list",
  "data": [
    {
      "filename": "photo.png",
      "content_type": "image/png",
      "status": "success",
      "reason": null
    },
    {
      "filename": "bad.bin",
      "content_type": "application/octet-stream",
      "status": "failed",
      "reason": "Unsupported file type"
    }
  ]
}
```

Public items contain filename, content type, status (`success` or `failed`), and a safe reason when failed. Embedding vectors, Qdrant point IDs, image descriptions, image bytes, API keys, tracebacks, and local paths are never returned.

### Supported content

Type detection uses file bytes through `python-magic`; filename extensions do not determine type.

- Manual uploads: PNG, JPEG, WEBP — routed through image description pipeline.
- Provider sync: PNG, JPEG, WEBP, MP4, MOV, WEBM — provider videos use configured `VIDEO_MODEL`.
- Text and PDF files are unsupported.

Provider-video processing downloads private provider bytes into process RAM only. App uploads them to temporary Google Gen AI Files API object, deletes object after processing, and does not write video files to local disk.

### Limits and errors

- Maximum 10 files per request
- Maximum 25 MB per file
- Maximum 250 MB aggregate request body
- Images exceeding 100 million pixels are rejected
- Requests are rate-limited to 60 requests per minute per client address
- Missing files or more than 10 files return HTTP 400
- Empty, oversized, unsupported, invalid, model-failed, or storage-failed files return per-file errors with HTTP 200 when the request itself is valid

## Vector search

`POST /v1/search` embeds query text with configured `EMBEDDING_MODEL` and returns image vectors scoring at or above `SEARCH_THRESHOLD`, ordered by similarity. Results carry upload filename, MIME type, and stored description text. Legacy payload-less points are excluded.

```bash
curl -X POST http://localhost:8000/v1/search \
  -H "Content-Type: application/json" \
  -d '{"query":"a red sports car","limit":10}'
```

Response:

```json
{
  "object": "list",
  "data": [
    {
      "point_id": "3f2b...",
      "score": 0.87,
      "filename": "photo.png",
      "file_path": "photos/2026/photo.png",
      "file_type": "image/png",
      "content": "Description text..."
    }
  ]
}
```

- `query` must be a single non-blank string (max 8192 characters).
- `limit` is optional, default 10, valid range 1–100.
- `SEARCH_THRESHOLD` must be set before calling this endpoint; when unset the endpoint returns HTTP 503 with `{"detail":"Search is not configured"}`.
- Requires the same bearer auth and rate limit as uploads.

## Health

```bash
curl http://localhost:8000/health
```

Healthy response:

```json
{"status":"ok","qdrant":"ok","model":"ok"}
```

The `model` field reports `ok` only when both `DESCRIPTION_MODEL` and `EMBEDDING_MODEL` are reachable from the configured endpoint. The overall status becomes `degraded` when any of the three dependencies (description, embedding, Qdrant) reports unavailable.

## Administrator account

Configure one administrator account in `.env`; this project has no registration, user database, or password reset flow.

```bash
uv run python -c 'from argon2 import PasswordHasher; print(PasswordHasher().hash("choose-a-strong-password"))'
uv run python -c 'import secrets; print(secrets.token_urlsafe(48))'
```

Set first output as `ADMIN_PASSWORD_HASH` and second as `ADMIN_SESSION_SECRET`. Set `ADMIN_USERNAME` to chosen username. Never commit `.env`, password hash, or session secret.

Set `ADMIN_ALLOWED_ORIGIN` to exact public frontend origin without path, query, or trailing slash. Examples: `http://localhost:5173` for local Vite development, `https://assets.example.com` for hosted site. Changing `ADMIN_SESSION_SECRET` invalidates existing sessions.

## Privacy

- Image bytes leave app only as description request to configured image model endpoint.
- Provider-video bytes leave app only as temporary Google Gen AI Files API upload for configured `VIDEO_MODEL`; temporary remote file deletes after processing.
- Provider asset descriptions persist in Qdrant payloads alongside provider identity, filename, MIME type, and source URL so search results can surface them.
- Manually uploaded image vectors store no payload.
- API responses never expose raw vectors, API keys, tracebacks, or local paths.

## Security

File uploads and vector search use in-memory per-client rate limiting (60 requests/min). Administrative management endpoints require signed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie from configured administrator account. Sessions expire after two hours; login and admin changes require exact `ADMIN_ALLOWED_ORIGIN`. Compose publishes app and Qdrant ports on loopback by default. Keep services behind trusted/private networks or an authenticated gateway in production.

For production deployments behind a reverse proxy (e.g. Nginx, Traefik, Caddy, or AWS ALB), enforce ingress request body limits (such as Nginx `client_max_body_size 250m;`) to bound chunked uploads before body spooling occurs at the ASGI application server level.

Health checks use low-cost model listing and do not submit embedding or description requests.

## Frontend (Embedding UI)

A small Vite + React + TypeScript SPA at `frontend/` for uploading files and searching vectors against the running FastAPI backend.

### Setup

```bash
cd frontend
npm install
cp .env.example .env.local   # optional — adjust VITE_API_BASE / VITE_API_KEY
```

### Run (dev)

```bash
# Terminal 1: backend on :8000
uv run uvicorn backend.app.main:create_app --factory --reload

# Terminal 2: frontend on :5173 (proxies /v1 + /health to :8000)
cd frontend && npm run dev
```

Open `http://localhost:5173/`.

### Storage admin

Open `http://localhost:5173/admin` to operate configured providers. Sign in using configured `ADMIN_USERNAME` and source password used to create `ADMIN_PASSWORD_HASH`. Browser receives signed `HttpOnly`, `Secure`, `SameSite=Strict` session cookie; it is never stored in browser storage, URLs, logs, or frontend environment variables. Sessions expire after two hours. Sign out to clear cookie.

### Build

```bash
cd frontend && npm run build   # tsc + vite build, output in frontend/dist
```

### Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE` | empty (same-origin) | Backend root URL. Leave empty — Vite and Docker proxies forward `/v1`, `/health`, `/auth`, and `/admin/sync/` to backend. Set only if backend gains credentialed CORS support. |
| `VITE_API_KEY` | unset | Optional bearer token sent as `Authorization: Bearer <key>`. Not needed when running behind the Docker frontend proxy (nginx injects the header). |
| `PROXY_TARGET` | `http://localhost:8000` | Dev-only: Vite dev-server proxy target. Never bundled into the app. |

Note: `/v1/search` additionally requires the backend `SEARCH_THRESHOLD` to be configured; the UI surfaces the backend's 503 error as a banner when it is not.