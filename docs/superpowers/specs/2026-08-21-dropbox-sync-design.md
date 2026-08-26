# Multi-Provider Storage Sync Design

## Goal

Add Dropbox folder sync using refresh-token authentication alongside existing Google Drive sync. Providers are registered in backend code, not selected by environment configuration. Each provider runs only when an administrator explicitly clicks its sync button.

## Scope

- Sync configured Dropbox folder and nested folders.
- Keep Google Drive available as separate, manually triggered provider.
- Ingest every provider's supported files through one shared file-processing, model, embedding, and Qdrant pipeline.
- Detect new, changed, and removed files per provider on each manual sync.
- Present separate provider cards, status, traces, and sync controls in frontend `/admin` route.
- Allow future providers through one provider-adapter contract.
- Do not add browser OAuth authorization, folder picker, persisted client-side credentials, or automatic scheduled sync.

## Configuration

Provider registry is hard-coded in backend. No `STORAGE_PROVIDER` environment setting exists. Google Drive and Dropbox remain registered implementations; a provider activates only if its required server configuration exists.

```env
# Google Drive
DRIVE_SERVICE_ACCOUNT_JSON=
DRIVE_FOLDER_ID=

# Dropbox
DROPBOX_APP_KEY=
DROPBOX_APP_SECRET=
DROPBOX_REFRESH_TOKEN=
DROPBOX_ROOT_PATH=/team-assets
```

Credentials stay server-only environment values. Dropbox SDK exchanges refresh token for short-lived access tokens. Missing/invalid provider configuration disables only that provider. No credentials appear in logs, traces, or API responses.

## Architecture

Rename `backend/app/drive/` to `backend/app/storage/`. All source-sync code lives under provider-neutral storage package:

```text
backend/app/storage/
  __init__.py
  client.py       # StorageClient, shared records, Google Drive + Dropbox adapters
  registry.py     # hard-coded provider registry
  scheduler.py    # per-provider manual reconciliation
  sync_state.py   # provider-qualified reconciliation state
```

Update all application imports from `backend.app.drive` to `backend.app.storage`. Rename Drive-specific contract, scheduler, trace, and persistence names to storage/provider-neutral terms. Existing Google Drive API behavior remains adapter-only.

Create provider-neutral storage contracts:

- `StorageClient`: recursively list configured root, download file, health check.
- `StorageFile`: immutable provider name, provider-qualified stable ID, name, MIME type, modified timestamp, source URL.
- `DownloadedStorageFile`: immutable storage metadata, content bytes, optional effective export MIME type.
- `ProviderRegistry`: immutable code-defined map of provider names to enabled `StorageClient`, root identifier, and per-provider `SyncScheduler`.

`GoogleDriveClient` and `DropboxClient` implement `StorageClient`. Each adapter owns source authentication, folder traversal, metadata mapping, and download. Every adapter emits same contracts into shared scheduler, file ingestion service, image-description model, embedding model, and Qdrant store.

Future provider work adds one adapter and one hard-coded registry entry. It does not modify scheduler, file processing, models, embeddings, or Qdrant integration.

## Manual Sync Data Flow

1. App startup builds registry entries for Google Drive and Dropbox; missing configuration marks individual provider disabled.
2. Admin selects one provider card and triggers `POST /admin/sync/{provider}`.
3. Only selected provider's scheduler traverses its configured root and compares provider-qualified IDs with Qdrant records.
4. New/changed files download and enter shared file ingestion service.
5. File processor extracts document text; images use existing image-description model.
6. Extracted text/descriptions use existing embedding model; vectors and provider source metadata store in Qdrant.
7. Removed files delete only vector points belonging to selected provider.
8. Provider card receives its own counts and safe trace results. No scheduled/background sync occurs.

Flow:

```text
Google Drive ─┐
Dropbox ──────┼→ provider adapter → per-provider manual scheduler → shared ingestion → models → Qdrant
Future ───────┘
```

Provider-qualified IDs prevent cross-provider collisions. All sources share one model/vector pipeline; adapters change only source access.

## API and UI

Protected admin endpoints become provider-specific:

- `POST /admin/sync/{provider}` — trigger only requested registered provider.
- `GET /admin/sync/status` — return status records for every registered provider.
- `POST /admin/sync/{provider}/reindex/{storage_file_id}` — delete one provider's records, allowing next manual sync to re-ingest it.

`provider` is validated against code registry; unknown provider returns 404. Disabled provider returns safe 503 without credentials. Existing Vite frontend owns `/admin`: `App.tsx` selects an `AdminPage` from browser path, while nginx falls back to frontend `index.html` for that SPA route. `AdminPage` renders one card per known provider with name, health/config state, latest counts/traces, and its own Sync button.

Administrator enters `ADMIN_API_KEY` after opening `/admin`. Key exists only in React component memory and sends as bearer authorization only to protected admin requests; refresh or new tab clears it. Do not save key to localStorage, sessionStorage, URL, frontend environment configuration, logs, or error displays. Backend removes its static-file mount and HTML `/admin` routes but retains `/admin/sync/...` APIs. All endpoints retain admin bearer authorization.

## Failure Handling

- Provider auth/listing/download errors log server diagnostic context without secrets.
- Traces use safe failure descriptions.
- One provider failure cannot block another provider's manual sync.
- Per-file ingestion failure increments that provider's failed count while remaining files continue.
- Disabled provider does not run; health/status reports disabled.

## Tests

Test first:

- Google Drive + Dropbox code registry, config isolation, and disabled state.
- Dropbox paged recursive traversal, MIME filtering, metadata conversion, download, health using SDK fakes.
- Provider-specific routes: authorization, unknown provider 404, disabled provider 503, trigger/status/reindex isolation.
- Provider-qualified ID isolation in reconciliation and Qdrant persistence.
- Dropbox and Drive handoff to identical file processor, image-description model, embedding model, Qdrant metadata flow.
- Frontend `/admin` provider cards, individual manual buttons, status/traces, and nginx SPA fallback.
- Backend tests for removed static mount and `/admin` HTML response are deleted or rewritten to assert those backend routes no longer exist; frontend tests replace their coverage.
- In-memory-only admin key: admin requests include bearer key, page reload clears it, and browser persistence APIs never receive it.
- No automatic scheduler start or periodic provider sync.

Run backend unit/integration suites, frontend tests, and coverage check before completion.
