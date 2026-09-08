# Admin Dashboard Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build authenticated dark admin dashboard with per-provider detected/embedded counts, model health, safe Refresh, and independent live activity panels for two or more concurrent provider syncs.

**Architecture:** Keep existing `/admin/sync/status` as dashboard snapshot endpoint and add an explicit provider Refresh endpoint. Add a POST SSE sync endpoint that runs one provider scheduler, streams its safe per-file trace events, and finishes with a terminal snapshot; each request owns its own queue and stream, so different providers run independently while each existing `StorageSyncScheduler` lock still serializes same-provider work. React holds refresh, stream, events, and scroll state per provider and renders one independently scrollable activity panel per open stream.

**Tech Stack:** FastAPI, Pydantic v2, asyncio, Starlette `StreamingResponse`, pytest, React 18, TypeScript, Vite, Vitest, Testing Library, CSS.

**Spec:** `docs/superpowers/specs/2026-08-26-admin-dashboard-design.md`

## Global Constraints

- Dashboard may read Qdrant provider-scoped metadata only; never return vectors, file contents, endpoints, credentials, raw exceptions, or stack traces.
- Two or more providers must support concurrent Sync requests and independently rendered activity panels.
- Refresh never ingests, embeds, deletes, or changes provider/Qdrant data.
- Status, Refresh, Sync, and stream access require existing admin session; Refresh and Sync enforce existing allowed-origin protection.
- SSE response uses `Content-Encoding: identity`; every stream event is a complete `data: <json>\n\n` frame.
- Synchronous provider/Qdrant/model calls run through `asyncio.to_thread`; do not use nested event loops, manual threads, or `asyncio.run`.
- Preserve current login/session error handling and existing final sync endpoint compatibility.
- UI: graphite/slate surfaces; blue for Ready and Embedded; amber for warning/focus/in-progress; Inter UI text and IBM Plex Mono labels.
- Use immutable values and Pydantic response DTOs. TDD: prove RED before implementation, then GREEN and refactor.
- Leave changes uncommitted unless user explicitly asks.

---

## File Structure

| Path | Responsibility |
|---|---|
| `backend/app/api/schemas/admin.py` | Immutable response/event DTOs for dashboard counts, models, refresh, and SSE activity. |
| `backend/app/admin_dashboard/status_service.py` | Provider snapshot and model-health collection; isolates failures to a single metric. |
| `backend/app/admin_dashboard/sync_stream.py` | Per-request event queue, safe SSE serialization, and scheduler-to-stream bridge. |
| `backend/app/storage/registry.py` | Carries provider configured root alongside registered client/scheduler. |
| `backend/app/storage/scheduler.py` | Emits incremental immutable trace items through optional observer without changing final sync result. |
| `backend/app/model/description_client.py` | Exposes configured description model name through protocol/implementation. |
| `backend/app/main.py` | Builds/stores dashboard dependency bundle from existing real clients; supports injected test bundle. |
| `backend/app/api/routes/admin/sync.py` | Thin protected status, refresh, final sync, and streaming-sync handlers. |
| `backend/tests/unit/test_admin_dashboard_status.py` | Status/refresh metric and model-health unit coverage. |
| `backend/tests/unit/test_admin_sync_stream.py` | Stream framing, ordered traces, terminal event, and isolation tests. |
| `backend/tests/integration/test_admin_routes.py` | Auth/origin/response/SSE integration coverage. |
| `frontend/src/types.ts` | Mirrors dashboard, refresh, and stream DTOs. |
| `frontend/src/api/client.ts` | Typed snapshot/refresh calls and fetch-based POST SSE reader. |
| `frontend/src/components/AdminPage.tsx` | Per-provider dashboard state, actions, independent activity panels, and stream lifecycle. |
| `frontend/src/components/AdminPage.test.tsx` | Admin dashboard interaction and concurrent-stream rendering coverage. |
| `frontend/src/styles.css` | Scoped dark graphite admin styles and five-row scroll activity panel. |

### Task 1: Define dashboard contracts and provider roots

**Files:**
- Modify: `backend/app/api/schemas/admin.py:1-55`
- Modify: `backend/app/storage/registry.py:50-118`
- Modify: `backend/app/model/description_client.py:25-154`
- Test: `backend/tests/unit/test_schemas.py`
- Test: `backend/tests/unit/test_storage_registry.py`
- Test: `backend/tests/unit/test_description_client.py`

**Interfaces:**
- Produces immutable `ModelHealthStatus`, `ProviderDashboardStatus`, `AdminDashboardStatusResponse`, `AdminProviderRefreshResponse`, `SyncActivityEvent`, and `SyncTerminalEvent` Pydantic DTOs.
- Produces `ProviderSync.root: str | None` and `ImageDescriptionClient.model_name: str`.
- Later tasks consume these exact names and fields.

- [ ] **Step 1: Write failing schema and provider-root tests**

```python
@pytest.mark.unit
def test_admin_dashboard_status_serializes_provider_counts_and_models() -> None:
    response = AdminDashboardStatusResponse(
        providers=[ProviderDashboardStatus(
            provider="google_drive", display_name="Google Drive", enabled=True,
            health="ok", detected_count=3, embedded_count=2,
        )],
        embedding_model=ModelHealthStatus(name="embed-v1", health="ok"),
        description_model=ModelHealthStatus(name="describe-v1", health="unavailable"),
    )
    assert response.model_dump()["providers"][0]["embedded_count"] == 2
    assert response.model_dump()["description_model"]["health"] == "unavailable"

@pytest.mark.unit
def test_registry_keeps_configured_root_on_provider_entry() -> None:
    registry = build_provider_registry(_settings(DRIVE_FOLDER_ID="folder-1"), Mock(), Mock())
    assert registry.get("google_drive").root == "folder-1"
```

Add description-client test asserting its configured description model is exposed through `model_name` and no endpoint value is exposed.

- [ ] **Step 2: Run target tests and verify RED**

Run:
```bash
uv run pytest backend/tests/unit/test_schemas.py backend/tests/unit/test_storage_registry.py backend/tests/unit/test_description_client.py -v
```

Expected: import/attribute failures for dashboard DTOs, provider root, and description `model_name`.

- [ ] **Step 3: Add minimal immutable contracts**

Implement fields exactly as pseudocode below:

```text
Provider dashboard status:
  provider, display_name, enabled, health
  detected_count nullable integer
  embedded_count nullable integer
  existing last-sync fields

Model health status:
  name
  health

Dashboard response:
  providers
  embedding_model
  description_model

Refresh response:
  provider dashboard status
  embedding_model
  description_model

Activity event:
  sequence, provider, filename nullable, status, detail, terminal false

Terminal event:
  sequence, provider, detected_count nullable, embedded_count nullable,
  upserted, deleted, unchanged, failed, terminal true
```

Keep all Pydantic models frozen. Add nullable `root` before `health_cache` on `ProviderSync`; pass Drive/Dropbox settings root into entries. Add `model_name` property to description protocol and implementation returning configured identifier only.

- [ ] **Step 4: Run target tests and verify GREEN**

Run same command from Step 2.

Expected: PASS.

- [ ] **Step 5: Format and lint changed backend files**

Run:
```bash
uv run ruff format backend/app/api/schemas/admin.py backend/app/storage/registry.py backend/app/model/description_client.py backend/tests/unit/test_schemas.py backend/tests/unit/test_storage_registry.py backend/tests/unit/test_description_client.py
uv run ruff check backend/app/api/schemas/admin.py backend/app/storage/registry.py backend/app/model/description_client.py backend/tests/unit/test_schemas.py backend/tests/unit/test_storage_registry.py backend/tests/unit/test_description_client.py
```

Expected: no lint violations.

### Task 2: Build isolated dashboard snapshot service

**Files:**
- Create: `backend/app/admin_dashboard/__init__.py`
- Create: `backend/app/admin_dashboard/status_service.py`
- Modify: `backend/app/main.py:45-170`
- Test: `backend/tests/unit/test_admin_dashboard_status.py`

**Interfaces:**
- Consumes `ProviderRegistry`, `QdrantStore`, embedding model client, description client, and Task 1 DTOs.
- Produces `AdminDashboardStatusService.get_status() -> AdminDashboardStatusResponse` and `refresh_provider(provider: str) -> AdminProviderRefreshResponse`.
- `main.create_app()` stores `application.state.admin_dashboard_status_service`.

- [ ] **Step 1: Write failing service tests**

```python
@pytest.mark.unit
async def test_status_returns_provider_detected_and_metadata_counts() -> None:
    service = AdminDashboardStatusService(
        registry=_registry(root="root"), qdrant_store=_Qdrant(hits=3),
        embedding_client=_Model("embed-v1", "ok"), description_client=_Model("describe-v1", "ok"),
    )
    response = await service.get_status()
    provider = response.providers[0]
    assert provider.detected_count == 2
    assert provider.embedded_count == 3

@pytest.mark.unit
async def test_status_isolates_qdrant_failure_to_embedded_count() -> None:
    response = await _service(qdrant_store=_Qdrant(error=QdrantStorageError("failure"))).get_status()
    assert response.providers[0].detected_count == 2
    assert response.providers[0].embedded_count is None

@pytest.mark.unit
async def test_disabled_provider_avoids_storage_and_qdrant_reads() -> None:
    client, qdrant = _Client(), _Qdrant(hits=1)
    response = await _service(registry=_disabled_registry(client), qdrant_store=qdrant).get_status()
    assert response.providers[0].detected_count is None
    assert client.list_count == 0
    assert qdrant.lookup_count == 0
```

Also assert model names/health are returned, Refresh calls only selected provider `health_cache.refresh`, and Qdrant lookup uses `find_all_with_storage_key` rather than vector search.

- [ ] **Step 2: Run service tests and verify RED**

Run:
```bash
uv run pytest backend/tests/unit/test_admin_dashboard_status.py -v
```

Expected: FAIL because service module does not exist.

- [ ] **Step 3: Implement snapshot service and app composition**

Use this flow:

```text
get_status:
  map every registered provider through provider_status
  check embedding and description model health in worker threads
  return providers + model health

provider_status(entry, force_health):
  if disabled or no root: unavailable counts
  else concurrently offload:
    health cache get/refresh
    client list_files(root), then count list
    qdrant find_all_with_storage_key(provider), then count list
  catch provider failure -> only detected_count unavailable
  catch Qdrant failure -> only embedded_count unavailable
  return immutable provider status
```

Do not call provider client, Qdrant, or model client on event loop. Log original exception server-side; response exposes null count only. In `create_app`, build service from same description client, embedding client, Qdrant store, and registry already created for normal startup. Add optional dependency parameter only if tests need a fully injected service; do not construct clients in route handlers. Remove app-state service during lifespan cleanup.

- [ ] **Step 4: Run service tests and verify GREEN**

Run command from Step 2.

Expected: PASS.

- [ ] **Step 5: Run affected existing backend tests**

Run:
```bash
uv run pytest backend/tests/unit/test_storage_registry.py backend/tests/unit/test_description_client.py backend/tests/unit/test_admin_dashboard_status.py -v
```

Expected: PASS.

### Task 3: Add refresh and dashboard-status HTTP responses

**Files:**
- Modify: `backend/app/api/routes/admin/sync.py:1-101`
- Modify: `backend/app/main.py:45-170`
- Modify: `backend/tests/integration/test_admin_routes.py:1-201`

**Interfaces:**
- Consumes `AdminDashboardStatusService` from `request.app.state`.
- Produces protected `GET /admin/sync/status -> AdminDashboardStatusResponse` and `POST /admin/sync/{provider}/refresh -> AdminProviderRefreshResponse`.
- Existing `POST /admin/sync/{provider}` stays final-result endpoint unchanged.

- [ ] **Step 1: Write failing integration tests**

```python
@pytest.mark.integration
def test_authenticated_dashboard_status_includes_counts_and_model_health() -> None:
    registry, _, _ = _registry()
    with TestClient(_app(registry), base_url="https://testserver") as client:
        _login(client)
        response = client.get("/admin/sync/status")
    assert response.status_code == 200
    assert response.json()["providers"][0]["detected_count"] == 2
    assert response.json()["embedding_model"] == {"name": "embed-v1", "health": "ok"}

@pytest.mark.integration
def test_refresh_requires_allowed_origin_and_refreshes_one_provider() -> None:
    with TestClient(_app(_registry()[0]), base_url="https://testserver") as client:
        _login(client)
        rejected = client.post("/admin/sync/dropbox/refresh", headers={"Origin": "https://attacker.example.test"})
        accepted = client.post("/admin/sync/dropbox/refresh", headers={"Origin": TEST_ORIGIN})
    assert rejected.status_code == 403
    assert accepted.status_code == 200
    assert accepted.json()["provider"]["provider"] == "dropbox"
```

Also assert anonymous Refresh receives 401 and unknown provider returns 404 without calling storage/Qdrant.

- [ ] **Step 2: Run integration tests and verify RED**

Run:
```bash
uv run pytest backend/tests/integration/test_admin_routes.py -v
```

Expected: status response shape assertion fails and Refresh returns 404.

- [ ] **Step 3: Make route handlers thin**

Add private dependency accessor for app-state dashboard service. Replace route-local provider loop in status handler with one `await service.get_status()` call. Add Refresh handler that resolves provider with existing `_provider_or_404`, calls `await service.refresh_provider(provider)`, and declares existing admin access + origin dependencies. Keep all model response/status-code declarations explicit.

- [ ] **Step 4: Run integration tests and verify GREEN**

Run command from Step 2.

Expected: PASS, including existing auth/origin/sync tests.

- [ ] **Step 5: Format and lint backend changes**

Run:
```bash
uv run ruff format backend/app/api/routes/admin/sync.py backend/app/main.py backend/tests/integration/test_admin_routes.py
uv run ruff check backend/app/api/routes/admin/sync.py backend/app/main.py backend/tests/integration/test_admin_routes.py
```

Expected: no lint violations.

### Task 4: Stream provider sync progress as safe SSE

**Files:**
- Create: `backend/app/admin_dashboard/sync_stream.py`
- Modify: `backend/app/storage/scheduler.py:22-145`
- Modify: `backend/app/api/routes/admin/sync.py:1-101`
- Test: `backend/tests/unit/test_admin_sync_stream.py`
- Test: `backend/tests/integration/test_admin_routes.py`

**Interfaces:**
- `StorageSyncScheduler.tick_once(observer: Callable[[SyncTraceItem], None] | None = None) -> SyncTickResult` accepts optional trace observer.
- `ProviderSyncStream.run() -> AsyncIterator[bytes]` emits complete SSE frames for Task 1 activity/terminal DTOs.
- New `POST /admin/sync/{provider}/stream` returns `StreamingResponse` with `Content-Encoding: identity` and admin access + origin dependencies.

- [ ] **Step 1: Write failing stream unit tests**

```python
@pytest.mark.unit
async def test_stream_emits_ordered_safe_file_events_then_terminal_event() -> None:
    scheduler = _SchedulerWithTraces("dropbox", [
        _trace("file_download", "ok", "Downloaded file", "asset.png"),
        _trace("file_ingestion", "ok", "Indexed file", "asset.png"),
    ])
    frames = [frame async for frame in ProviderSyncStream("dropbox", scheduler, _snapshot).run()]
    events = [json.loads(frame.removeprefix(b"data: ").removesuffix(b"\n\n")) for frame in frames]
    assert [event["status"] for event in events[:-1]] == ["loading", "done"]
    assert events[-1]["terminal"] is True
    assert "vector" not in json.dumps(events)

@pytest.mark.unit
async def test_two_provider_streams_run_without_shared_events() -> None:
    drive, dropbox = _stream("google_drive"), _stream("dropbox")
    drive_frames, dropbox_frames = await asyncio.gather(_collect(drive), _collect(dropbox))
    assert all(b'"provider":"google_drive"' in frame for frame in drive_frames)
    assert all(b'"provider":"dropbox"' in frame for frame in dropbox_frames)
```

Also test failed trace maps to `failed` with generic safe detail, each frame ends exactly `\n\n`, and stream uses no content encoding other than identity.

- [ ] **Step 2: Run stream tests and verify RED**

Run:
```bash
uv run pytest backend/tests/unit/test_admin_sync_stream.py -v
```

Expected: FAIL because stream module and observer argument do not exist.

- [ ] **Step 3: Add scheduler observer and per-request stream bridge**

Refactor `_tick_blocking` trace helper to append immutable `SyncTraceItem` then call supplied observer immediately. Keep existing trace collection/final result identical. Map scheduler trace steps to UI states:

```text
file_download + ok -> loading
file_ingestion + ok -> done
file_ingestion + failed -> failed
provider traversal or Qdrant failures -> failed with no filename
all other trace steps -> omit from UI event stream
```

`ProviderSyncStream` creates an `asyncio.Queue` within request loop. Its observer uses `loop.call_soon_threadsafe(queue.put_nowait, trace)` because scheduler trace occurs in `asyncio.to_thread`. Run scheduler in a background task, yield queued mapped events with monotonically increasing sequence, then yield one terminal frame derived from final result plus refreshed provider snapshot. In `finally`, cancel/await the runner task if consumer disconnects. Do not use global mutable subscriber lists or manual threads.

Return `StreamingResponse(stream.run(), media_type="text/event-stream", headers={"Content-Encoding": "identity"})`. Stream starts scheduler run directly; existing final POST route remains untouched. Same provider scheduler lock serializes duplicate same-provider requests; different provider schedulers execute concurrently.

- [ ] **Step 4: Run stream tests and verify GREEN**

Run command from Step 2.

Expected: PASS.

- [ ] **Step 5: Add SSE route integration tests and run them**

Add tests with a streaming client that verify authenticated same-origin stream response, `content-encoding: identity`, 401 without session, 403 wrong origin, terminal payload, and two distinct provider streams containing only their own provider IDs.

Run:
```bash
uv run pytest backend/tests/integration/test_admin_routes.py backend/tests/unit/test_admin_sync_stream.py -v
```

Expected: PASS.

### Task 5: Add typed frontend status, refresh, and POST-SSE client

**Files:**
- Modify: `frontend/src/types.ts:35-68`
- Modify: `frontend/src/api/client.ts:1-120`
- Modify: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces TypeScript `ProviderDashboardStatus`, `ModelHealthStatus`, `AdminDashboardStatusResponse`, `AdminProviderRefreshResponse`, `SyncActivityEvent`, and `SyncTerminalEvent`.
- Produces `refreshAdminProvider(provider): Promise<AdminProviderRefreshResponse>`.
- Produces `streamAdminSync(provider, onEvent, signal): Promise<void>` using credentialed `fetch` POST and incremental SSE parsing.

- [ ] **Step 1: Write failing client tests**

```typescript
test("posts refresh request with admin credentials", async () => {
  fetchMock.mockResolvedValue(jsonResponse({ provider: providerStatus, embedding_model: model, description_model: model }));
  await refreshAdminProvider("dropbox");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/admin/sync/dropbox/refresh"), expect.objectContaining({ method: "POST", credentials: "include" }));
});

test("parses complete SSE frames in one streaming sync response", async () => {
  fetchMock.mockResolvedValue(sseResponse('data: {"provider":"dropbox","status":"loading","terminal":false}\n\ndata: {"provider":"dropbox","terminal":true}\n\n'));
  const events: SyncEvent[] = [];
  await streamAdminSync("dropbox", (event) => events.push(event), new AbortController().signal);
  expect(events).toHaveLength(2);
  expect(events[1].terminal).toBe(true);
});
```

Add test for malformed/non-200 response becoming existing `ApiError`; do not expose response body detail beyond existing safe API message.

- [ ] **Step 2: Run frontend client tests and verify RED**

Run:
```bash
cd frontend && npm test -- --run src/api/client.test.ts
```

Expected: TypeScript import/function failures.

- [ ] **Step 3: Implement types and incremental parser**

Use `adminRequest` for Refresh. For stream, use `fetch` with `method: "POST"`, `credentials: "include"`, `signal`, and existing admin origin headers. Read `response.body` through `TextDecoderStream`; buffer chunks and split only at blank-line frame boundaries. For each `data:` frame parse JSON then call `onEvent`. Ignore no other frame types. On terminal event finish normally. Always release reader lock in `finally`.

- [ ] **Step 4: Run client tests and typecheck**

Run:
```bash
cd frontend && npm test -- --run src/api/client.test.ts && npm run typecheck
```

Expected: PASS.

### Task 6: Implement independent provider dashboard UI and streams

**Files:**
- Modify: `frontend/src/components/AdminPage.tsx:1-177`
- Modify: `frontend/src/components/AdminPage.test.tsx:1-132`
- Modify: `frontend/src/styles.css:1-388`

**Interfaces:**
- Consumes Task 5 snapshot/refresh/stream functions and DTOs.
- Maintains `refreshingProviders: ReadonlySet<string>`, `syncingProviders: ReadonlySet<string>`, `activityByProvider: Readonly<Record<string, readonly SyncActivityEvent[]>>`, `openActivityProviders: ReadonlySet<string>`, and controller refs keyed by provider.
- Renders provider cards and model-health cards. Two or more provider syncs must render independent activity panels concurrently.

- [ ] **Step 1: Write failing AdminPage tests**

```tsx
test("renders detected and embedded counts plus model health after session restore", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboardStatus({ providers: [provider("google_drive", 20, 18)] }));
  render(<AdminPage />);
  expect(await screen.findByText("20")).toBeInTheDocument();
  expect(screen.getByText("nomic-embed-text")).toBeInTheDocument();
});

test("refresh disables only requested provider action", async () => {
  setupDashboard([provider("google_drive", 2, 1), provider("dropbox", 3, 2)]);
  render(<AdminPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Refresh Google Drive" }));
  expect(screen.getByRole("button", { name: "Refreshing Google Drive" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh Dropbox" })).toBeEnabled();
});

test("renders two independent activity panels for concurrent provider streams", async () => {
  mockedStreamAdminSync.mockImplementation((_provider, onEvent) => {
    onEvent(_provider === "google_drive" ? driveLoadingEvent : dropboxLoadingEvent);
    return new Promise(() => undefined);
  });
  setupDashboard([provider("google_drive", 2, 1), provider("dropbox", 3, 2)]);
  render(<AdminPage />);
  await userEvent.click(await screen.findByRole("button", { name: "Sync Google Drive" }));
  await userEvent.click(screen.getByRole("button", { name: "Sync Dropbox" }));
  expect(screen.getByLabelText("Google Drive sync activity")).toBeInTheDocument();
  expect(screen.getByLabelText("Dropbox sync activity")).toBeInTheDocument();
});
```

Add tests for a terminal event reloading only snapshot state, stream error restoring only matching Sync button with safe alert, disabled provider Sync, and activity viewport containing `max-height`/overflow behavior through class assertion.

- [ ] **Step 2: Run AdminPage tests and verify RED**

Run:
```bash
cd frontend && npm test -- --run src/components/AdminPage.test.tsx
```

Expected: failures for missing labels, Refresh, model cards, and stream client.

- [ ] **Step 3: Replace authenticated branch with approved dashboard**

Keep login form and existing unauthorized-session reset behavior. Implement immutable React state updates:

```text
Refresh provider:
  add provider to refreshing set
  await refresh call
  replace that provider snapshot and model health
  remove provider from refreshing set

Sync provider:
  add provider to syncing/open sets
  append each incoming event only to that provider activity list
  terminal event -> reload status snapshot; remove only that provider from syncing set
  error -> append safe failure/show alert; remove only that provider from syncing set
```

Use unique accessible names: `Refresh Google Drive`, `Sync Dropbox`, and `<section aria-label="Google Drive sync activity">`. Keep one `AbortController` per provider in `useRef`; abort and clear all controllers on unmount. Do not make one global syncing flag.

Render only safe filename/status/detail supplied by DTO. Activity list class has five-row fixed height and `overflow-y: auto`; after append, call `scrollIntoView({ block: "nearest" })` for active row only when list is at bottom before update, preserving manual inspection scroll position.

- [ ] **Step 4: Add scoped dark dashboard CSS**

Replace prior admin-grid/provider-card/activity styles with `.admin-dashboard*` scoped classes. Match mockup structure: graphite card/page surfaces, slate lines, blue embedded/ready, amber work/warning, model grid, mobile single column, and focus-visible outline. Add `align-items: start` on provider CSS grid so an open activity panel does not stretch a non-syncing card. Respect `prefers-reduced-motion` for active work indicator.

- [ ] **Step 5: Run frontend tests, typecheck, and build**

Run:
```bash
cd frontend && npm test -- --run src/components/AdminPage.test.tsx src/api/client.test.ts && npm run typecheck && npm run build
```

Expected: PASS.

### Task 7: Full verification and coverage gate

**Files:**
- Modify only if a test identifies a real regression in Tasks 1-6.
- Test: `backend/tests/unit/test_admin_dashboard_status.py`
- Test: `backend/tests/unit/test_admin_sync_stream.py`
- Test: `backend/tests/integration/test_admin_routes.py`
- Test: `frontend/src/components/AdminPage.test.tsx`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Consumes complete implementation from Tasks 1-6.
- Produces verification evidence for provider isolation, safe metadata-only responses, auth/origin enforcement, and frontend rendering.

- [ ] **Step 1: Run backend focused suite**

Run:
```bash
uv run pytest backend/tests/unit/test_admin_dashboard_status.py backend/tests/unit/test_admin_sync_stream.py backend/tests/integration/test_admin_routes.py -v
```

Expected: PASS.

- [ ] **Step 2: Run backend full suite with coverage**

Run project’s existing coverage command if configured; otherwise:

```bash
uv run pytest backend/tests --cov=backend/app --cov-report=term-missing
```

Expected: PASS and coverage at or above project-required 80%.

- [ ] **Step 3: Run frontend full suite and production build**

Run:
```bash
cd frontend && npm test -- --run && npm run typecheck && npm run build
```

Expected: PASS.

- [ ] **Step 4: Run Python formatter/linter final pass**

Run:
```bash
uv run ruff format --check backend/app backend/tests
uv run ruff check backend/app backend/tests
```

Expected: no output indicating violations.

- [ ] **Step 5: Inspect changed files and security boundary**

Run:
```bash
git diff --check
git diff -- backend/app/api/routes/admin/sync.py backend/app/admin_dashboard frontend/src/components/AdminPage.tsx frontend/src/api/client.ts
```

Verify: every state-changing route has admin session + origin protection; SSE has `Content-Encoding: identity`; no raw provider/Qdrant/model errors, vector data, contents, endpoint URLs, or credentials are in schemas/UI.

## Plan Self-Review

- **Spec coverage:** Tasks 1-3 implement status/model counts and Refresh; Task 4 implements safe per-file SSE and concurrent streams; Tasks 5-6 implement provider-scoped client/UI state, two-or-more panels, five-row vertical scroll, styles, and errors; Task 7 verifies auth/security/coverage.
- **Placeholder scan:** No TBD/TODO/deferred steps. Each task has exact files, interfaces, test examples, commands, and expected results.
- **Type consistency:** Task 1 DTO names flow into service, route, frontend types, client, and UI. `ProviderSyncStream`, `streamAdminSync`, and provider-keyed state names are fixed throughout.
