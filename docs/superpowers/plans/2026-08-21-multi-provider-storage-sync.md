# Multi-Provider Storage Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register Google Drive and Dropbox in code, manually sync either provider through one shared ingestion/model/Qdrant path, and relocate Drive sync implementation into `backend/app/storage/`.

**Architecture:** Provider adapters implement one immutable metadata/download contract in `backend.app.storage`. A code-defined `ProviderRegistry` owns one manually invoked scheduler per provider. Schedulers share existing `FileIngestionService`, description model, embedding model, and Qdrant store, but persist provider-qualified source identity so source records cannot collide.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic Settings, Dropbox Python SDK, google-api-python-client, Qdrant, pytest, React, TypeScript, Vite, nginx.

**Spec:** `docs/superpowers/specs/2026-08-21-dropbox-sync-design.md`

## Global Constraints

- Keep provider registry in backend code; do not add `STORAGE_PROVIDER` environment setting.
- Keep provider credentials and root locations server-only environment settings.
- Google Drive and Dropbox run only when admin triggers that provider; do not start periodic/background sync loops.
- New provider code lives under `backend/app/storage/`; remove application imports of `backend.app.drive`.
- Provider adapters may vary only source auth, traversal, metadata mapping, and download. File processing, image description, embeddings, and Qdrant write path remain shared.
- Use provider-qualified storage IDs for Qdrant lookup, deterministic point IDs, delete, reindex, and source metadata.
- Validate provider route values against code registry; unknown provider returns 404; configured-disabled provider returns 503.
- All admin sync endpoints require existing `ADMIN_API_KEY` bearer authorization.
- Never return or log Dropbox app secret, refresh token, access token, or Drive service-account content.
- Preserve immutable value objects: frozen dataclasses/Pydantic models; do not mutate input DTOs.
- Admin dashboard is frontend `/admin`; `ADMIN_API_KEY` stays React-memory-only and never uses browser storage, URL, logs, or frontend env config.
- Remove backend `StaticFiles` mount and HTML `/admin` endpoints; keep `/admin/sync/...` API routes.
- Write tests first; run affected pytest/frontend tests after each task; leave all changes uncommitted unless user explicitly requests commit.

---

## Target File Structure

```text
backend/app/storage/
  __init__.py                  # package exports
  client.py                    # StorageClient, StorageFile, DownloadedStorageFile, Drive/Dropbox clients
  registry.py                  # ProviderDefinition, ProviderRegistry, build_provider_registry
  scheduler.py                 # manual StorageSyncScheduler and SyncTickResult
  sync_state.py                # provider-qualified snapshot/Qdrant diff
backend/app/api/routes/admin/sync.py     # provider-specific protected routes
backend/app/api/schemas/admin.py         # provider status/result/trace responses
backend/app/config.py                    # Dropbox env settings; Drive interval removal
backend/app/main.py                      # build and expose registry; no scheduler start/stop
backend/app/file_embeddings/ingestion_service.py  # generic source metadata payload/search mapping
backend/app/integrations/qdrant_store.py # source-key lookup/delete and stable point IDs
backend/app/api/routes/health.py         # provider-aware health response
backend/app/api/schemas/health.py        # per-provider health fields/records
frontend/src/App.tsx                      # pathname selector
frontend/src/components/AdminPage.tsx      # in-memory-key provider administration
frontend/src/api/client.ts                 # typed admin request helpers
frontend/src/types.ts                      # provider admin response DTOs
frontend/nginx-templates/default.conf.template # `/admin` SPA fallback
backend/tests/unit/test_storage_client.py
frontend/src/components/AdminPage.test.tsx # provider-card/key behavior
frontend/src/App.test.tsx                  # `/admin` pathname selection
frontend tests/config files                # add Vitest/testing-library if absent
backend/tests/integration/test_routes.py   # remove/rewrite backend static admin tests
backend/tests/integration/test_compose_files.py # SPA fallback assertion

# Removed
backend/app/static/                        # backend no longer serves admin assets
backend `/admin` and `/admin/` HTML routes # backend retains admin API routes only

backend/tests/unit/test_storage_client.py
backend/tests/unit/test_provider_registry.py
backend/tests/unit/test_storage_sync_state.py
backend/tests/unit/test_storage_scheduler.py
backend/tests/unit/test_ingestion_service.py
backend/tests/unit/test_qdrant_store.py
backend/tests/integration/test_admin_routes.py
backend/tests/integration/test_routes.py
.env.example
README.md
pyproject.toml
uv.lock
```

### Task 1: Establish generic storage records and rename package

**Files:**
- Create: `backend/app/storage/__init__.py`
- Create: `backend/app/storage/client.py`
- Create: `backend/tests/unit/test_storage_client.py`
- Delete after move: `backend/app/drive/client.py`, `backend/app/drive/__init__.py`
- Modify: all existing imports of `backend.app.drive.client`

**Interfaces:**
- Produces `StorageFile(provider: str, id: str, name: str, mime_type: str, modified_time: datetime, size: int, source_url: str | None = None)`.
- Produces `DownloadedStorageFile(file: StorageFile, content: bytes, export_mime_type: str | None = None)`.
- Produces `StorageClient` protocol with `list_files(root: str) -> list[StorageFile]`, `download(storage_file_id: str) -> DownloadedStorageFile`, `check_health() -> str`.
- Produces `GoogleDriveClient` as `StorageClient` implementation and `DisabledStorageClient(provider: str)`.
- Later tasks consume only `StorageFile` and `StorageClient`, never `DriveFile`/`DriveClient`.

- [ ] **Step 1: Write failing generic-contract tests**

```python
from datetime import datetime, timezone

from backend.app.storage.client import StorageFile


def test_storage_file_is_immutable_and_carries_provider_metadata() -> None:
    file = StorageFile(
        provider="google_drive",
        id="drive-file-1",
        name="notes.txt",
        mime_type="text/plain",
        modified_time=datetime(2026, 8, 21, tzinfo=timezone.utc),
        size=12,
        source_url="https://drive.google.com/file/d/drive-file-1/view",
    )

    assert file.provider == "google_drive"
    assert file.id == "drive-file-1"
    assert file.source_url == "https://drive.google.com/file/d/drive-file-1/view"
```

Add migrated Drive tests asserting recursive traversal, Google-native export, raw-file download, disabled health, and missing config behavior through `StorageClient` names.

- [ ] **Step 2: Run tests and verify import failure**

Run: `uv run pytest backend/tests/unit/test_storage_client.py -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.app.storage'`.

- [ ] **Step 3: Move client implementation and make records generic**

Create `backend/app/storage/client.py` with this contract shape, then move/rename existing Drive implementation into it:

```python
@dataclass(frozen=True)
class StorageFile:
    provider: str
    id: str
    name: str
    mime_type: str
    modified_time: datetime
    size: int
    source_url: str | None = None


class StorageClient(Protocol):
    def list_files(self, root: str) -> list[StorageFile]: ...
    def download(self, storage_file_id: str) -> DownloadedStorageFile: ...
    def check_health(self) -> str: ...
```

Map Google IDs unchanged, set `provider="google_drive"`, and build source URLs on metadata conversion. Rename `traverse_folder` to `list_files`. Retain Google-only export handling within `GoogleDriveClient`. Delete obsolete `backend/app/drive/` package after all imports in this task point to `backend.app.storage.client`.

- [ ] **Step 4: Run unit tests and import scan**

Run:

```bash
uv run pytest backend/tests/unit/test_storage_client.py -v
rg "backend\.app\.drive|DriveFile|DriveClient" backend/app backend/tests
```

Expected: storage-client tests pass. Remaining Drive terms are provider adapter names/test descriptions only; no `backend.app.drive` import remains.

- [ ] **Step 5: Format and lint changed Python**

Run:

```bash
uv run ruff format backend/app/storage backend/tests/unit/test_storage_client.py
uv run ruff check backend/app/storage backend/tests/unit/test_storage_client.py
```

Expected: exit code 0.

### Task 2: Add Dropbox storage adapter and configuration

**Files:**
- Modify: `backend/app/config.py`
- Modify: `backend/app/storage/client.py`
- Modify: `backend/tests/unit/test_storage_client.py`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `pyproject.toml`
- Modify: `uv.lock`

**Interfaces:**
- Consumes `StorageClient`, `StorageFile`, and `DownloadedStorageFile` from Task 1.
- Produces `DropboxClient(app_key: str, app_secret: str, refresh_token: str, root_path: str)`.
- Produces `build_dropbox_client(settings: Settings) -> StorageClient` and `is_dropbox_configured(settings: Settings) -> bool`.
- `Settings` gains nullable `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REFRESH_TOKEN`, `DROPBOX_ROOT_PATH`.

- [ ] **Step 1: Write failing Dropbox adapter/config tests**

Add tests using Dropbox SDK fakes injected into `DropboxClient` constructor or a test-only `from_client` constructor:

```python
def test_dropbox_client_recursively_pages_and_keeps_supported_files() -> None:
    client = DropboxClient.from_client(_DropboxStub.with_entries(...), root_path="/assets")

    assert [file.name for file in client.list_files("/assets")] == ["guide.pdf", "photo.png"]
    assert all(file.provider == "dropbox" for file in client.list_files("/assets"))


def test_dropbox_client_download_returns_bytes_and_source_url() -> None:
    downloaded = DropboxClient.from_client(_DropboxStub.with_download(...), "/assets").download("id:abc")

    assert downloaded.content == b"file content"
    assert downloaded.file.source_url == "https://www.dropbox.com/home/assets/guide.pdf"


def test_dropbox_is_disabled_when_any_required_setting_is_missing() -> None:
    assert is_dropbox_configured(_settings(DROPBOX_REFRESH_TOKEN=None)) is False
```

Also test health returns `"ok"` for a successful root listing and `"unavailable"` when SDK raises. Do not construct live Dropbox clients in tests.

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest backend/tests/unit/test_storage_client.py -k dropbox -v`

Expected: FAIL because Dropbox client/config members do not exist.

- [ ] **Step 3: Add dependency, settings, and minimal adapter**

Add `dropbox>=12.0.0` to runtime dependencies, update lockfile with `uv lock`, then add nullable settings:

```python
DROPBOX_APP_KEY: str | None = None
DROPBOX_APP_SECRET: str | None = None
DROPBOX_REFRESH_TOKEN: str | None = None
DROPBOX_ROOT_PATH: str | None = None
```

Build Dropbox SDK with refresh-token OAuth and use `files_list_folder`, `files_list_folder_continue`, and `files_download`. Recursively list `FolderMetadata` children, retain supported MIME/file-extension types, and map each `FileMetadata` to immutable `StorageFile(provider="dropbox", ...)`. Use Dropbox metadata revision/modified time and provider URL. Catch SDK exceptions only in `check_health`; traversal/download should propagate so scheduler records safe failure trace.

Add only Dropbox credential/root placeholders and explanatory comments to `.env.example`/README. Never put token values in docs or test fixture output.

- [ ] **Step 4: Run Dropbox tests**

Run: `uv run pytest backend/tests/unit/test_storage_client.py -k dropbox -v`

Expected: PASS.

- [ ] **Step 5: Run formatting, lint, and dependency consistency checks**

Run:

```bash
uv run ruff format backend/app/config.py backend/app/storage/client.py backend/tests/unit/test_storage_client.py
uv run ruff check backend/app/config.py backend/app/storage/client.py backend/tests/unit/test_storage_client.py
uv lock --check
```

Expected: all commands exit 0.

### Task 3: Make ingestion and Qdrant source-provider neutral

**Files:**
- Modify: `backend/app/file_embeddings/ingestion_service.py`
- Modify: `backend/app/integrations/qdrant_store.py`
- Modify: `backend/app/api/schemas/vector_search.py`
- Modify: `backend/tests/unit/test_ingestion_service.py`
- Modify: `backend/tests/unit/test_qdrant_store.py`
- Modify: `backend/tests/integration/test_qdrant_drive.py` (rename to `test_qdrant_storage.py`)

**Interfaces:**
- Produces `FileUpload(provider: str, storage_file_id: str, source_url: str | None, ...)`.
- Qdrant payload keys: `provider`, `storage_file_id`, `source_url`, `modified_time`.
- Produces `stable_point_id(provider: str, storage_file_id: str) -> str`.
- Produces `find_by_storage_key(provider: str, storage_file_id: str)`, `find_all_with_storage_key(provider: str)`, and `delete_by_storage_key(provider: str, storage_file_id: str)` on `QdrantStore`.

- [ ] **Step 1: Write failing payload/isolation tests**

```python
def test_stable_point_id_separates_same_identifier_across_providers() -> None:
    assert stable_point_id("google_drive", "same-id") != stable_point_id("dropbox", "same-id")


def test_ingestion_persists_provider_source_metadata_for_search_result() -> None:
    service = make_service(...)
    response = service.process_files((
        FileUpload(
            provider="dropbox",
            storage_file_id="id:abc",
            source_url="https://www.dropbox.com/home/assets/guide.pdf",
            filename="guide.pdf",
            content_type="application/pdf",
            content=b"...",
            file_path="/assets/guide.pdf",
            modified_time=MODIFIED,
        ),
    ))

    assert response.data[0].status == "success"
    assert fake_qdrant.payloads[0]["provider"] == "dropbox"
    assert fake_qdrant.payloads[0]["storage_file_id"] == "id:abc"
```

Add Qdrant fake-client tests for lookup/delete filters containing both `provider` and `storage_file_id`, and a search-result test that returns stored `source_url` directly rather than assembling a Drive URL.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
uv run pytest backend/tests/unit/test_ingestion_service.py backend/tests/unit/test_qdrant_store.py -k "provider or storage" -v
```

Expected: FAIL due to missing generic fields/functions.

- [ ] **Step 3: Replace Drive-specific persistence model**

Replace `drive_id` payload and Qdrant API with generic source keys. Use an immutable upload record:

```python
@dataclass(frozen=True)
class FileUpload:
    provider: str
    storage_file_id: str
    source_url: str | None
    filename: str
    content_type: str
    content: bytes
    file_path: str
    modified_time: datetime
```

Persist full payload for all processed file kinds, including text/PDF and images. Pass `point_id=stable_point_id(file.provider, file.storage_file_id)` to `store_embedding` so changed source files replace their own vector consistently. Return `source_url` and provider/storage identity in `VectorSearchItem`; remove Drive URL string construction.

Define Qdrant filter helpers that always constrain both keys. Preserve current legacy Drive records only if migration compatibility is required by existing tests; otherwise old unqualified `drive_id` records are intentionally outside new provider registry reconciliation.

- [ ] **Step 4: Run focused tests**

Run:

```bash
uv run pytest backend/tests/unit/test_ingestion_service.py backend/tests/unit/test_qdrant_store.py backend/tests/integration/test_qdrant_storage.py -v
```

Expected: PASS.

- [ ] **Step 5: Run formatting and lint**

Run:

```bash
uv run ruff format backend/app/file_embeddings/ingestion_service.py backend/app/integrations/qdrant_store.py backend/app/api/schemas/vector_search.py backend/tests/unit/test_ingestion_service.py backend/tests/unit/test_qdrant_store.py
uv run ruff check backend/app/file_embeddings/ingestion_service.py backend/app/integrations/qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/unit/test_qdrant_store.py
```

Expected: exit code 0.

### Task 4: Move reconciliation/scheduler into storage and remove automatic loops

**Files:**
- Create: `backend/app/storage/sync_state.py`
- Create: `backend/app/storage/scheduler.py`
- Create: `backend/tests/unit/test_storage_sync_state.py`
- Create: `backend/tests/unit/test_storage_scheduler.py`
- Delete after move: `backend/app/drive/sync_state.py`, `backend/app/drive/scheduler.py`

**Interfaces:**
- Consumes Task 1 `StorageClient`/`StorageFile`, Task 3 `FileUpload` and generic `QdrantStore` methods.
- Produces `StorageSyncScheduler(provider: str, storage_client: StorageClient, root: str, ingestion_service: FileIngestionService, qdrant_store: QdrantStore)`.
- Produces `SyncTickResult(provider: str, upserted: int, deleted: int, unchanged: int, failed: int, traces: tuple[SyncTraceItem, ...])`.
- `tick_once()` is only execution method; scheduler exposes no `start`, `stop`, periodic task, or interval setting.

- [ ] **Step 1: Write failing provider-isolation and manual-only tests**

```python
@pytest.mark.asyncio
async def test_tick_once_only_reads_and_deletes_selected_provider_records() -> None:
    scheduler = _scheduler(provider="dropbox", files=[_file("dropbox", "id:1")])

    result = await scheduler.tick_once()

    assert result.provider == "dropbox"
    assert fake_qdrant.find_calls == [("dropbox",)]
    assert fake_ingestion.uploads[0].provider == "dropbox"


def test_manual_scheduler_has_no_periodic_start_or_stop_methods() -> None:
    assert not hasattr(StorageSyncScheduler, "start")
    assert not hasattr(StorageSyncScheduler, "stop")
```

Migrate existing new/changed/unchanged/deleted/per-file failure tests to `StorageFile`. Add test that `delete_for_reindex("id:1")` calls generic Qdrant delete with scheduler's provider and supplied ID.

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest backend/tests/unit/test_storage_sync_state.py backend/tests/unit/test_storage_scheduler.py -v`

Expected: FAIL because storage scheduler/state modules do not exist.

- [ ] **Step 3: Move generic diff and manual scheduler implementation**

Replace all Drive-specific fields/trace names with generic source names. Reconciliation reads only `find_all_with_storage_key(self._provider)`. Convert each downloaded item to Task 3 `FileUpload` and preserve its `source_url`. Use `asyncio.to_thread` only around blocking provider SDK, Qdrant, and model path, as current scheduler does. Return safe trace details using provider display name but never error object credentials.

Create only these public methods:

```python
@property
def last_result(self) -> SyncTickResult | None: ...

async def tick_once(self) -> SyncTickResult: ...

async def delete_for_reindex(self, storage_file_id: str) -> int: ...
```

Do not retain `_run_forever`, interval fields, task/event state, or scheduler build function dependent on `DRIVE_SYNC_INTERVAL_SECONDS`.

- [ ] **Step 4: Run storage scheduler/state tests**

Run: `uv run pytest backend/tests/unit/test_storage_sync_state.py backend/tests/unit/test_storage_scheduler.py -v`

Expected: PASS.

- [ ] **Step 5: Confirm Drive package removed and format**

Run:

```bash
find backend/app/drive -type f -print
uv run ruff format backend/app/storage backend/tests/unit/test_storage_sync_state.py backend/tests/unit/test_storage_scheduler.py
uv run ruff check backend/app/storage backend/tests/unit/test_storage_sync_state.py backend/tests/unit/test_storage_scheduler.py
```

Expected: `find` reports no source files; Ruff exits 0.

### Task 5: Add hard-coded provider registry and application wiring

**Files:**
- Create: `backend/app/storage/registry.py`
- Modify: `backend/app/storage/__init__.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/routes/health.py`
- Modify: `backend/app/api/schemas/health.py`
- Modify: `backend/tests/unit/test_provider_registry.py`
- Modify: `backend/tests/unit/test_bootstrap.py`
- Modify: `backend/tests/integration/test_routes.py`
- Modify: `backend/tests/integration/test_compose_files.py`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Produces `ProviderRegistry(providers: Mapping[str, ProviderSync])`.
- Produces `ProviderSync(name: str, display_name: str, scheduler: StorageSyncScheduler | None, client: StorageClient)`.
- Produces `build_provider_registry(settings, ingestion_service, qdrant_store) -> ProviderRegistry` with literal code-defined entries `google_drive` and `dropbox`.
- `create_app(..., provider_registry: ProviderRegistry | None = None)` stores `application.state.provider_registry`.

- [ ] **Step 1: Write failing registry/wiring tests**

```python
def test_registry_contains_code_defined_google_drive_and_dropbox_entries() -> None:
    registry = build_provider_registry(_settings_with_no_provider_config(), _service(), _store())

    assert registry.names == ("google_drive", "dropbox")
    assert registry.get("google_drive").scheduler is None
    assert registry.get("dropbox").scheduler is None


def test_registry_enables_only_configured_provider() -> None:
    registry = build_provider_registry(_settings_with_dropbox_config(), _service(), _store())

    assert registry.get("dropbox").scheduler is not None
    assert registry.get("google_drive").scheduler is None


def test_application_lifespan_does_not_start_provider_schedulers() -> None:
    registry = _registry_with_tracking_scheduler()
    app = create_app(service=_service(), provider_registry=registry)

    with TestClient(app):
        pass

    assert registry.get("dropbox").scheduler.start_calls == 0
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest backend/tests/unit/test_provider_registry.py backend/tests/unit/test_bootstrap.py -k "registry or scheduler" -v`

Expected: FAIL because registry/wiring does not exist.

- [ ] **Step 3: Build code-defined registry and replace singleton app state**

Implement immutable registry using `MappingProxyType` or frozen tuple records. The code registry must explicitly construct adapters; no environment variable selects provider:

```python
PROVIDER_NAMES = ("google_drive", "dropbox")


def build_provider_registry(...) -> ProviderRegistry:
    return ProviderRegistry.from_entries((
        _build_google_drive_provider(settings, ingestion_service, qdrant_store),
        _build_dropbox_provider(settings, ingestion_service, qdrant_store),
    ))
```

Modify `create_app` to build/store `provider_registry`, remove `drive_client`/`sync_scheduler` app state, and remove lifecycle calls to scheduler `start()`/`stop()`. Health response becomes provider-aware, for example a frozen `StorageProviderHealth` list keyed by known provider; overall health treats disabled providers as expected.

Remove `DRIVE_SYNC_INTERVAL_SECONDS` from `Settings`, `.env.example`, README, and compose configuration because no periodic scheduler remains.

- [ ] **Step 4: Run registry/bootstrap/health tests**

Run:

```bash
uv run pytest backend/tests/unit/test_provider_registry.py backend/tests/unit/test_bootstrap.py backend/tests/integration/test_routes.py -k "registry or health or lifespan" -v
```

Expected: PASS.

- [ ] **Step 5: Format/lint and check configuration docs**

Run:

```bash
uv run ruff format backend/app/storage/registry.py backend/app/main.py backend/app/api/routes/health.py backend/app/api/schemas/health.py backend/tests/unit/test_provider_registry.py
uv run ruff check backend/app/storage/registry.py backend/app/main.py backend/app/api/routes/health.py backend/app/api/schemas/health.py backend/tests/unit/test_provider_registry.py
rg "DRIVE_SYNC_INTERVAL_SECONDS|STORAGE_PROVIDER" .env.example README.md backend docker-compose.yml
```

Expected: Ruff exits 0; search produces no matches.

### Task 6: Replace admin singleton routes with provider-specific routes

**Files:**
- Modify: `backend/app/api/routes/admin/sync.py`
- Modify: `backend/app/api/schemas/admin.py`
- Modify: `backend/tests/integration/test_admin_routes.py`
- Modify: `backend/tests/unit/test_schemas.py`

**Interfaces:**
- Consumes `ProviderRegistry` from Task 5 and `StorageSyncScheduler` from Task 4.
- Produces `POST /admin/sync/{provider}`, `GET /admin/sync/status`, and `POST /admin/sync/{provider}/reindex/{storage_file_id}`.
- Produces `ProviderSyncStatus` inside `AdminSyncStatusResponse(providers: list[ProviderSyncStatus])`.
- Produces `AdminSyncResponse(provider: str, upserted: int, deleted: int, unchanged: int, failed: int, traces: list[SyncTraceItem])`.

- [ ] **Step 1: Write failing route/schema tests**

```python
@pytest.mark.integration
def test_admin_runs_only_requested_provider(app: FastAPI) -> None:
    drive, dropbox = _stub_scheduler(), _stub_scheduler()
    app_with = create_app(service=_service(), admin_api_key="admin-secret", provider_registry=_registry(drive, dropbox))

    with TestClient(app_with) as client:
        response = client.post("/admin/sync/dropbox", headers=AUTH)

    assert response.status_code == 200
    assert response.json()["provider"] == "dropbox"
    assert dropbox.trigger_count == 1
    assert drive.trigger_count == 0

@pytest.mark.integration
def test_admin_rejects_unknown_provider(app: FastAPI) -> None:
    with TestClient(_configured_app()) as client:
        response = client.post("/admin/sync/not-real", headers=AUTH)

    assert response.status_code == 404

@pytest.mark.integration
def test_admin_returns_503_for_disabled_selected_provider(app: FastAPI) -> None:
    with TestClient(_app_with_disabled_dropbox()) as client:
        response = client.post("/admin/sync/dropbox", headers=AUTH)

    assert response.status_code == 503
    assert response.json() == {"detail": "Dropbox sync is not configured"}
```

Add status test expecting both registered providers in deterministic registry order, each with `enabled`, health, latest counts, and trace list. Keep malformed/missing bearer-token tests against provider-specific route. Add reindex test verifying only selected provider scheduler receives source ID.

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py backend/tests/unit/test_schemas.py -v`

Expected: FAIL with 404/response-model mismatch because provider routes/schemas are absent.

- [ ] **Step 3: Implement thin provider registry route helpers**

Use a small helper that validates registry lookup and maps failures:

```python
def get_provider_sync(request: Request, provider: str) -> ProviderSync:
    entry = request.app.state.provider_registry.get(provider)
    if entry is None:
        raise HTTPException(status_code=404, detail="Unknown storage provider")
    return entry
```

Each route must keep `Depends(require_admin_access)` and return Pydantic response models. If `entry.scheduler is None`, raise 503 using display name, not configuration details. Do not accept provider names outside literal registry. Rename trace identity field from `drive_id` to `storage_file_id`; include provider in traces/results. Remove legacy `/admin/sync` and `/admin/sync/reindex/{drive_id}` routes.

- [ ] **Step 4: Run route/schema tests**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py backend/tests/unit/test_schemas.py -v`

Expected: PASS.

- [ ] **Step 5: Format and lint**

Run:

```bash
uv run ruff format backend/app/api/routes/admin/sync.py backend/app/api/schemas/admin.py backend/tests/integration/test_admin_routes.py backend/tests/unit/test_schemas.py
uv run ruff check backend/app/api/routes/admin/sync.py backend/app/api/schemas/admin.py backend/tests/integration/test_admin_routes.py backend/tests/unit/test_schemas.py
```

Expected: exit code 0.

### Task 7: Move admin dashboard to frontend `/admin`

**Files:**
- Create: `frontend/src/components/AdminPage.tsx`
- Create: `frontend/src/components/AdminPage.test.tsx`
- Create: `frontend/src/App.test.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/nginx-templates/default.conf.template`
- Modify: `frontend/package.json`, `frontend/package-lock.json` (add test tooling only if absent)
- Modify: `backend/app/main.py`
- Modify/Delete: backend tests covering mounted `StaticFiles` or HTML `/admin` response
- Modify: `backend/tests/integration/test_compose_files.py`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Consumes Task 6 API: `GET /admin/sync/status`, `POST /admin/sync/{provider}`, `POST /admin/sync/{provider}/reindex/{storage_file_id}`.
- Produces `AdminPage` with `adminApiKey` held only in React state.
- Produces typed frontend client calls accepting `adminApiKey: string`, never reading browser storage.
- Produces SPA path selector: `/admin` → `AdminPage`; all other paths → existing asset search UI.

- [ ] **Step 1: Write failing frontend and backend-removal tests**

Add component tests with mocked fetch/client:

```tsx
it("renders an admin-key prompt before fetching provider status", () => {
  render(<AdminPage />)

  expect(screen.getByLabelText("Admin API key")).toBeVisible()
  expect(mockFetch).not.toHaveBeenCalled()
})

it("runs only selected provider with in-memory bearer key", async () => {
  render(<AdminPage />)
  await userEvent.type(screen.getByLabelText("Admin API key"), "admin-secret")
  await userEvent.click(screen.getByRole("button", { name: "Load providers" }))
  await userEvent.click(screen.getByRole("button", { name: "Sync Dropbox" }))

  expect(mockAdminSync).toHaveBeenCalledWith("dropbox", "admin-secret")
  expect(mockAdminSync).not.toHaveBeenCalledWith("google_drive", "admin-secret")
  expect(localStorage.getItem("ADMIN_API_KEY")).toBeNull()
  expect(sessionStorage.getItem("ADMIN_API_KEY")).toBeNull()
})

it("renders AdminPage at /admin", () => {
  window.history.replaceState({}, "", "/admin")
  render(<App />)

  expect(screen.getByRole("heading", { name: "Storage sync" })).toBeVisible()
})
```

Replace any backend test expecting HTML from `/admin` or `/admin/static` with a test that application routes do not include those endpoints. Add nginx template test requiring `try_files $uri $uri/ /index.html;` so direct `/admin` loads SPA.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd frontend && npm test -- --run
cd .. && uv run pytest backend/tests/integration/test_routes.py backend/tests/integration/test_compose_files.py -v
```

Expected: frontend test command/config or components missing; backend static-route removal test fails until route deletion.

- [ ] **Step 3: Implement frontend admin path, memory-only key, and provider cards**

Create `AdminPage` with local React state only:

```tsx
const [adminApiKey, setAdminApiKey] = useState("")
const [providers, setProviders] = useState<ProviderSyncStatus[]>([])
```

Do not use `localStorage`, `sessionStorage`, URL query parameters, Vite `VITE_*` key config, console logging, or error rendering of the entered key. After user clicks `Load providers`, call typed `getAdminSyncStatus(adminApiKey)`. Render each server-supplied provider as a card with state, counts, traces, and own `Sync {displayName}` button. Disable only pressed provider while its request runs; invoke `triggerAdminSync(provider, adminApiKey)` and refresh status after completion. Display API-safe error detail only.

Extend `App.tsx` to select `AdminPage` exactly for `window.location.pathname === "/admin"`; preserve existing main page otherwise. Add typed response/client functions that set `Authorization: Bearer ${adminApiKey}` only on admin requests.

Remove `StaticFiles`, `FileResponse`, static mount, and `/admin`/`/admin/` routes from `backend/app/main.py`. Do not remove admin API router. Configure nginx fallback to frontend `index.html` for unknown client routes, including `/admin`.

- [ ] **Step 4: Run frontend/backend focused tests**

Run:

```bash
cd frontend && npm test -- --run
cd .. && uv run pytest backend/tests/integration/test_routes.py backend/tests/integration/test_compose_files.py -v
```

Expected: PASS.

- [ ] **Step 5: Update setup docs and check no backend static/dashboard remains**

Update README to direct administrators to frontend `/admin`, explain key exists for current page memory only, configure providers, and click individual provider sync. Keep `.env.example` secret placeholders blank.

Run:

```bash
rg "backend/app/static|StaticFiles|FileResponse|@app.get\(\"/admin|sessionStorage|localStorage|VITE_.*ADMIN" backend frontend README.md .env.example
rg '"/admin/sync"|/sync/reindex/|drive_id|DRIVE_SYNC_INTERVAL_SECONDS' frontend/src README.md .env.example docker-compose.yml
```

Expected: first scan finds no backend static serving or browser key persistence. Second scan finds no legacy API field/endpoint names; provider endpoint templates remain.

### Task 8: Full regression, security scan, and completion check

**Files:**
- Modify only if failures require production-code correction: files from Tasks 1–7
- Verify: `docs/superpowers/specs/2026-08-21-dropbox-sync-design.md`
- Verify: `docs/superpowers/specs/2026-08-21-dropbox-sync-design.html`

**Interfaces:**
- Verifies complete code-defined multi-provider manual sync workflow, frontend-only admin route, session-memory auth key, and unchanged shared model/Qdrant behavior.

- [ ] **Step 1: Run complete backend test suite with coverage**

Run:

```bash
uv run pytest --cov=backend/app --cov-report=term-missing
```

Expected: all tests pass; total coverage is at least 80%.

- [ ] **Step 2: Run frontend tests and production build**

Run:

```bash
cd frontend && npm test -- --run && npm run build
```

Expected: all frontend tests and TypeScript/Vite production build pass.

- [ ] **Step 3: Run formatting and lint across project**

Run:

```bash
uv run ruff format --check backend
uv run ruff check backend
cd frontend && npm run lint
```

Expected: exit code 0.

- [ ] **Step 4: Scan legacy/static names and secret literals**

Run:

```bash
rg "backend\.app\.drive|DriveClient|DriveFile|drive_id|DRIVE_SYNC_INTERVAL_SECONDS|STORAGE_PROVIDER|backend/app/static|StaticFiles|FileResponse" backend frontend .env.example README.md docker-compose.yml
rg -n --glob '!*.lock' --glob '!.env' 'DROPBOX_(APP_SECRET|REFRESH_TOKEN)\s*=\s*[^\s#]+' .
rg -n 'localStorage|sessionStorage|VITE_.*ADMIN|ADMIN_API_KEY.*console' frontend/src
```

Expected: no production legacy module/static-server references; no real Dropbox values; no browser persistence or logging of admin key.

- [ ] **Step 5: Verify manual provider behavior and leave changes uncommitted**

Run:

```bash
uv run pytest backend/tests/integration/test_admin_routes.py -k "requested_provider or disabled_selected_provider or unknown_provider" -v
git status --short
```

Expected: selected provider runs alone, disabled provider returns 503, unknown provider returns 404. Changes remain uncommitted; do not run `git add`, `git commit`, or `git push`.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 deliver Drive/Dropbox adapters and server-only config. Tasks 3–4 establish provider-qualified shared model/Qdrant flow and remove periodic execution. Task 5 delivers code-defined registry/no provider env selection. Task 6 delivers protected manual per-provider APIs, status, trace, and reindex behavior. Task 7 removes backend static admin delivery and delivers frontend `/admin`, provider cards, memory-only key, and SPA fallback. Task 8 covers no legacy imports/static backend route, no secret literals/browser key persistence, full test/coverage/lint/build, and uncommitted completion.
- **Placeholder scan:** No TBD/TODO/deferred implementation steps. Each implementation task contains exact file set, interfaces, test shape, commands, and expected outcomes.
- **Type consistency:** `StorageFile`/`DownloadedStorageFile` feed `FileUpload`; `StorageSyncScheduler` produces `SyncTickResult`; `ProviderRegistry` routes scheduler lookup; provider name + storage file ID are used uniformly through Qdrant, routes, and frontend admin client.

### Task 8: Full regression, security scan, and completion check

**Files:**
- Modify only if failures require production-code correction: files from Tasks 1–7
- Verify: `docs/superpowers/specs/2026-08-21-dropbox-sync-design.md`
- Verify: `docs/superpowers/specs/2026-08-21-dropbox-sync-design.html`

**Interfaces:**
- Verifies complete code-defined multi-provider manual sync workflow and unchanged shared model/Qdrant behavior.

- [ ] **Step 1: Run complete test suite with coverage**

Run:

```bash
uv run pytest --cov=backend/app --cov-report=term-missing
```

Expected: all tests pass; total coverage is at least 80%.

- [ ] **Step 2: Run formatting and lint across project**

Run:

```bash
uv run ruff format --check backend
uv run ruff check backend
```

Expected: exit code 0.

- [ ] **Step 3: Scan for old module/import/API names and secret literals**

Run:

```bash
rg "backend\.app\.drive|DriveClient|DriveFile|drive_id|DRIVE_SYNC_INTERVAL_SECONDS|STORAGE_PROVIDER" backend frontend .env.example README.md docker-compose.yml
rg -n --glob '!*.lock' --glob '!.env' 'DROPBOX_(APP_SECRET|REFRESH_TOKEN)\s*=\s*[^\s#]+' .
```

Expected: first scan has no production legacy names apart from human-facing `Google Drive` strings and adapter class names. Second scan finds placeholders only, never real values.

- [ ] **Step 4: Verify manual behavior through integration test boundary**

Run:

```bash
uv run pytest backend/tests/integration/test_admin_routes.py -k "requested_provider or disabled_selected_provider or unknown_provider" -v
```

Expected: selected provider runs alone, disabled provider returns 503, unknown provider returns 404.

- [ ] **Step 5: Review uncommitted changes and leave them uncommitted**

Run: `git status --short`

Expected: implementation, docs, and tests listed as changed; do not run `git add`, `git commit`, or `git push`.

## Plan Self-Review

- **Spec coverage:** Tasks 1–2 deliver Drive/Dropbox adapters and server-only config. Tasks 3–4 establish provider-qualified shared model/Qdrant flow and remove periodic execution. Task 5 delivers code-defined registry/no provider env selection. Task 6 delivers protected manual per-provider APIs, status, trace, and reindex behavior. Task 7 delivers one admin card/button per provider. Task 8 covers no legacy imports, no secret literals, full test/coverage/lint, and uncommitted completion.
- **Placeholder scan:** No TBD/TODO/deferred implementation steps. Each implementation task contains exact file set, interfaces, test shape, commands, and expected outcomes.
- **Type consistency:** `StorageFile`/`DownloadedStorageFile` feed `FileUpload`; `StorageSyncScheduler` produces `SyncTickResult`; `ProviderRegistry` routes scheduler lookup; provider name + storage file ID are used uniformly through Qdrant, routes, and traces.
