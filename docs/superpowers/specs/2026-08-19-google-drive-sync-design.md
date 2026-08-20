# Google Drive Sync — Design

Date: 2026-08-20
Status: Draft
Branch: feat/simple-visualizer

## Summary

Add a background sync loop that traverses a single configured Google
Drive folder on a monthly cadence (and on startup). New and changed files are
downloaded, embedded through the existing `FileIngestionService`, and
indexed in Qdrant. Files removed from Drive are removed from Qdrant.
Drive is the production ingestion source; the manual upload route stays
as a Drive-aware test scaffold that requires a `drive_id` per payload.
End users only see the existing Search tab. Admin-only endpoints under
`/admin/*` (behind `ADMIN_API_KEY`) expose on-demand sync, status, and
per-file reindex; a single-page admin UI at `/admin/ui` wraps them.
Search results link back to the original Drive asset.

## Goals

- Drive is the production ingestion source. `POST /v1/file-embeddings`
  stays as a Drive-aware test scaffold: every request must carry a
  `drive_id` (and optional `modified_time`) per file; uploads without
  one are rejected. The route exists to keep the upload flow
  exercisable end-to-end without spinning up a real Drive folder.
- The Upload tab and `uploadFiles` client are removed from the UI; the
  route stays for scripted tests behind `UPLOAD_API_KEY`.
- Admin can trigger an out-of-band sync and inspect state via
  `/admin/sync` and `/admin/sync/status`, or through the single-page
  admin UI at `/admin/ui`.
- Sync interval is once per month (`DRIVE_SYNC_INTERVAL_SECONDS`,
  default 30 days). Initial scan runs on startup.
- Reuses the existing `FileIngestionService` so embeddings use the same
  code path regardless of source.
- Reuses Qdrant payloads for sync bookkeeping (`drive_id`,
  `modified_time`). Known-file set seeds from a Qdrant payload scroll at
  startup — no new database, no lost state across restarts.
- End users never see Drive auth, sync state, or admin controls.
- Search results carry a `source_url` pointing at the original Drive
  asset; opening it is gated by Drive's own sharing settings, not the
  backend.

## Non-Goals

- Per-user Drive OAuth. Auth is service-account only.
- Watching multiple folders or the entire Drive.
- Drive push-notification webhooks (needs a public HTTPS endpoint and a
  channel that expires ~every 7 days).
- Writing back to Drive.
- A polished, multi-page admin app. The admin UI is one static page
  (key gate, status panel, sync trigger, reindex form). The JSON
  endpoints stay the canonical API surface.
- OCR for scanned PDFs (existing pipeline limit).
- Backend proxying of file bytes or end-user permission checks — Drive
  sharing settings are the access gate.

## Discovery mechanism

Drive's `changes.list` is whole-drive, so it does not fit single-folder
scoping. Instead the scanner does a **folder traversal**:

```
files.list(q="'<FOLDER_ID>' in parents and trashed=false",
           fields="files(id,name,mimeType,modifiedTime)", pageSize=1000)
traverse into mimeType == application/vnd.google-apps.folder
paginate with pageToken until exhausted
```

Change detection compares each file's Drive `modifiedTime` against the
`modified_time` stored on the Qdrant point payload. Deletion detection
diffs the traversal result against the known-ID set (seeded from Qdrant at
startup).

## Architecture

```
┌────────────────────────────┐
│ FastAPI app                │
│                            │
│  /v1/search ──► Qdrant     │ ◄── end users
│  /health ──► healthdeps    │
│  (upload removed)          │
│  /admin/sync               │ ◄── admin only
│  /admin/sync/status        │
│  /admin/sync/reindex/{id}  │
│  /admin/ui (static page)   │
│                            │
│  lifespan (startup):       │
│    drive_client = build()  │
│    known_ids = scroll from │
│      Qdrant payloads       │
│    scheduler.start()       │
│                            │
│  scheduler (asyncio task): │
│    initial scan            │
│    sleep DRIVE_SYNC_...    │
│    loop                    │
└────────────────────────────┘
```

New packages: `backend/app/drive/` (client, sync state, scheduler) plus
`backend/app/api/routes/admin.py`. Reuses `FileIngestionService` and the
Qdrant store.

## Configuration

All values read once at app startup via the existing `Settings` class.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DRIVE_SERVICE_ACCOUNT_JSON` | When Drive enabled | None | Full service-account JSON as a single env var. |
| `DRIVE_FOLDER_ID` | When Drive enabled | None | Single Drive folder ID to watch. All subfolders included. |
| `DRIVE_SYNC_INTERVAL_SECONDS` | No | `2592000` (30 days) | Sleep between scheduled scans. Initial startup scan always runs when Drive is configured. |
| `UPLOAD_API_KEY` | No | None | Bearer token required for `POST /v1/file-embeddings`. When unset, the route returns 403. Used only by scripted tests. |
| `ADMIN_API_KEY` | No | None | Bearer token required for `/admin/*`. When unset, admin endpoints return 403. Separate from `UPLOAD_API_KEY`. |

Drive sync is enabled when both `DRIVE_SERVICE_ACCOUNT_JSON` and
`DRIVE_FOLDER_ID` are set; otherwise the scheduler never starts and
`/health` reports `drive: "disabled"`.

`.env.example` ships placeholders. `DRIVE_FOLDER_ID` is admin's private
folder; never exposed in UI.

## Components

### `backend/app/drive/client.py`

Thin wrapper over `googleapiclient.discovery.build('drive', 'v3', ...)`.
Three methods:

```
DriveFile (immutable record):
    drive_id           # Google's file ID
    name
    mime_type
    modified_time      # timezone-aware UTC
    drive_path         # e.g. "Reports/2026/Q1.pdf"

DriveClient:
    traverse_folder(folder_id) -> list of DriveFile
        # folder traversal; skips trashed; files only

    download(drive_id, mime_type) -> bytes
        # native files: fetch raw content
        # Google-native (docs/sheets/slides): export to PDF first

    check_health() -> "ok" | "unavailable"
        # ping via about.get
```

Runs in a thread via `asyncio.to_thread` (googleapiclient is sync;
backend rules forbid blocking the event loop).

### `backend/app/drive/sync_state.py`

Holds the known-ID set plus last-run bookkeeping. No I/O except the
Qdrant seed:

```
SyncState:
    seed_from_qdrant() -> count
        # scroll all points, collect payload drive_id values

    diff(seen) -> SyncPlan
        # upsert = all seen files (modified_time dedup happens at
        # ingest time); delete_ids = known - seen

    record_upserted(drive_id)
    record_deleted(drive_id)
```

`SyncPlan` is immutable: `upsert` (list of DriveFile), `delete_ids`
(list of drive IDs).

### `backend/app/drive/scheduler.py`

Async loop. Owns one `DriveClient`, one `SyncState`, the ingestion
service, and the Qdrant store:

```
SyncScheduler:
    start()
        # seed state from Qdrant, run initial scan, then sleep loop

    stop()

    tick_once() -> SyncResult
        # one full scan; public so /admin/sync can call it
```

`tick_once` per file: read existing Qdrant point payload by `drive_id`;
skip when `modified_time` matches Drive's `modifiedTime`; else download
and pass (filename, content_type, content, file_path=drive_path) into
the ingestion service with extra payload `{drive_id, modified_time}`.

Requires one new Qdrant store method: `find_by_drive_id(drive_id)` and
`delete_by_drive_id(drive_id)` (filter on payload field), and passing
extra payload through on upsert.

### `backend/app/api/routes/admin.py`

Three endpoints, all behind `require_admin` (bearer `ADMIN_API_KEY`).
Shared status codes: `401` missing bearer token, `403` wrong key,
`503` Drive sync disabled (not configured).

- `POST /admin/sync` — runs `scheduler.tick_once()`, returns
  `{upserted: int, skipped: int, deleted: int, failed: int, duration_ms: int}`.
  - `200` scan completed (body carries the result, even when `failed > 0`).
  - `409` a scan is already running.
- `GET /admin/sync/status` — returns `{enabled: bool, running: bool,
  known_files: int, last_sync_at: str | null, last_result: object | null}`.
  - `200` always when reachable (read-only, never fails on Drive state).
- `POST /admin/sync/reindex/{drive_id}` — fetches metadata + bytes,
  forces an upsert regardless of `modified_time`, returns
  `{reembedded: bool}`.
  - `200` reindex completed.
  - `404` `drive_id` not present in the watched folder or Qdrant.
  - `409` a scan is already running.
  - `502` Drive API unreachable/auth failure during fetch.

Admin auth reuses the bearer pattern from `backend/app/security.py`.

### `backend/app/static/admin.html`

Single static page served at `GET /admin/ui`. The page shell is
unauthenticated (it contains no state); every data call carries the
admin key as a bearer token.

- **Key gate** — paste `ADMIN_API_KEY`; verified with
  `GET /admin/sync/status`. `200` → key stored in `sessionStorage`,
  dashboard shown. `401`/`403` → error banner, key discarded.
  `503` → read-only "sync disabled" notice.
- **Status panel** — `enabled`, `running` (live indicator),
  `known_files`, `last_sync_at`, `last_result` counters. Polls every
  5 s while `running: true`.
- **Run sync now** — `POST /admin/sync`; button disabled with spinner
  while running; `409` → toast "scan already running".
- **Reindex form** — `drive_id` text input →
  `POST /admin/sync/reindex/{drive_id}`; `404` → inline error;
  success shows `{reembedded}`.

No framework, one file, `fetch()` only — a thin client over the JSON
endpoints. All state lives server-side.

### `backend/app/api/routes/health.py` (extend)

`HealthResponse` gains `drive: str` (`ok | unavailable | disabled`).
`/health` stays public; the frontend already removed the health badge,
so this is for curl/admin visibility only.

## Frontend changes

- Remove the Upload tab from `App.tsx`; render `SearchPanel` directly.
- Delete `UploadPanel.tsx` and the unused `uploadFiles` client function.
- `SearchPanel` renders an "Open in Drive" link from `source_url` when
  present.
- No new components.

## Upload route — Drive-aware test scaffold

`POST /v1/file-embeddings` stays as a Drive-aware test scaffold. Every
request must declare the Google Drive ID per file; without it, the
upload has no link back to its source and the deletion logic can't
identify it.

- Request body: multipart, one or more `files` fields plus matching
  `drive_id` and optional `modified_time` form fields per file.
- **Validation**: missing `drive_id` → `422` per file. `modified_time`
  optional, defaults to "now" if absent.
- The route constructs the same `FileUpload` value the scheduler uses,
  with `drive_id` and `modified_time` threaded into the Qdrant payload
  alongside the existing `filename`, `file_path`, `file_type`,
  `content`.
- `FileUpload` gains `drive_id: str` and `modified_time: datetime`. The
  field is required for both ingestion paths — scheduler and this
  route.
- Auth: `UPLOAD_API_KEY` (separate from `ADMIN_API_KEY`). When unset,
  the route returns 403.
- Response shape (`FileEmbeddingResponse`) is unchanged.
- UI hides the Upload tab; this route is for scripted tests only.

End-user behavior is unchanged: users never see the route, and any
indexed file (Drive or scripted) carries a `source_url` derived from
`drive_id`.

## Removal list

Backend and frontend code that disappears once Drive is the source:

- `UploadPanel.tsx`, the `upload` tab state in `App.tsx`
- `uploadFiles` in `frontend/src/api/client.ts`
- README "POST /v1/file-embeddings" UI examples

The route, `UPLOAD_API_KEY`, `FileUpload`, and `FileEmbeddingItem` /
`FileEmbeddingResponse` schemas stay — used by scripted tests.

## Data flow

### Scheduled scan (happy path)

```
1. start a scan (tick_once)
2. files = traverse the watched folder        # runs in a thread
3. plan = diff(files) against known IDs
4. for each file in plan.upsert:
     existing = look up stored point by drive_id
     if it exists and modified_time is unchanged: skip
     content = download the file
     ingest (name, mime type, content, drive path) with
       extra payload {drive_id, modified_time}
     record as upserted
5. for each id in plan.delete_ids:
     delete stored point by drive_id
     record as deleted
```

### First run

Known-ID set is empty (fresh Qdrant) → everything in the folder is
upserted. Restart with data present → seed from Qdrant, so deletions
remain detectable.

## End-user asset access

Search results link back to the original Drive asset:

- The scheduler stores `drive_id` on every synced point payload.
- `_to_search_item` derives
  `source_url = "https://drive.google.com/file/d/<drive_id>/view"`
  when the payload carries a `drive_id`; `null` otherwise.
- `VectorSearchItem` gains `source_url: str | None`.
- `SearchPanel` renders an "Open in Drive" link when present.

Images only for now: only image points carry a full payload today
(`_has_full_payload` filters the rest), so only images get a
`source_url`. This matches the current pipeline scope.

Access model: the backend never proxies file bytes and performs no
permission check of its own. Opening `source_url` is gated entirely by
Drive's sharing settings on the file. Prerequisite: the watched folder
is shared with the intended audience (workspace-wide or link sharing).
Users without access see Drive's own 403 / request-access page.
`drive_id` in the response is an identifier, not a secret — it grants
nothing without Drive-side permission.

## Error handling

- **Drive API 429 / 5xx** — retry with backoff, 5 attempts inside
  `traverse_folder`/`download`. After exhaustion, abort this tick; next
  scan retries everything (traversals are idempotent). Never crash the
  loop.
- **Drive auth failure (401/403)** — log loudly; `/health` reports
  `drive: "unavailable"`. Search keeps working on existing Qdrant data.
- **Per-file ingest failure** — counted in `SyncResult.failed`; reason
  surfaces via `GET /admin/sync/status`. Loop continues with next file.
- **Network blip during download** — one retry, then count as failed.
- **Concurrent scans** — `tick_once` guarded by an `asyncio.Lock`;
  `POST /admin/sync` and `POST /admin/sync/reindex/{id}` return 409
  when busy.

## Testing

- **Unit** — `DriveClient` with fake `googleapiclient` service objects:
  subfolder traversal, pagination, Google-native export branch.
- **Unit** — `SyncState.diff`: new files, deletions, seed-from-empty.
- **Unit** — `SyncScheduler.tick_once` with mocked client/store: skip
  when unchanged, upsert when modified, delete removal, lock behavior.
- **Unit** — admin auth: 403 without key, 200 with; 409 when busy.
- **Integration** — fake Drive fixture → real `FileIngestionService` +
  real Qdrant → assert vectors present with `drive_id` payload; remove a
  file from fixture, rescan, assert point deleted.
- **Manual** — real test folder; initial scan; second `POST /admin/sync`
  shows `skipped == upserted` from the first.
- **Manual** — admin UI: wrong key rejected at the gate; status panel
  updates during a triggered scan; reindex `404` surfaces inline.
- **Unit** — upload route: rejects files missing `drive_id` (422);
  accepts `drive_id` + optional `modified_time` and writes the same
  Qdrant payload as the scheduler.

## Out-of-scope follow-ups

- Push notifications (webhooks).
- Multi-folder watching.
- Per-user OAuth + personalized search.
- OCR for scanned PDFs.
- Progress streaming for very large folders.

## Open risks

- **Drive API quota** — personal-scale folders are far under quota;
  monthly cadence keeps it negligible.
- **Large folders** — initial traversal of thousands of files takes minutes;
  `GET /admin/sync/status` shows `running: true` meanwhile.
- **Google-native exports** — docs/sheets/slides export as PDF; their
  text goes through the PDF path. Quality depends on export fidelity.
