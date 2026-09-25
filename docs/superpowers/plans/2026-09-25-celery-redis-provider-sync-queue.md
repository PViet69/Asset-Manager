# Celery and Redis Provider Sync Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run admin-triggered provider sync and ingestion in Celery workers, exposing safe Redis-backed status through polling instead of a blocking API request or SSE stream.

**Architecture:** FastAPI validates and queues a provider identifier, while Celery workers rebuild their own service graph and reuse `StorageSyncScheduler` to perform work. Redis is Celery broker/result backend plus source of truth for provider locks, cancellation requests, and safe progress. Frontend polls one authenticated status endpoint every three seconds and keeps provider-scoped stop control.

**Tech Stack:** Python 3.11, FastAPI, Pydantic Settings, Celery, Redis, pytest, React 18, TypeScript, Vitest, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-25-celery-redis-task-queue-design.md`

## Global Constraints

- Queue only provider sync plus ingestion; do not queue unrelated admin work.
- Use Redis for broker, result backend, provider locks, cancellation signals, and safe progress; result expiry is exactly 24 hours.
- Use JSON task and result serialization only.
- Default `CELERY_WORKER_CONCURRENCY=4`; make it configurable.
- Preserve existing admin-session authentication, allowed-origin checks, and rate limiting on changed/new control endpoints.
- Keep `POST /admin/sync/{provider}/stop`; add only `GET /admin/sync-jobs/{job_id}`.
- Replace synchronous `POST /admin/sync/{provider}` response with `202 Accepted` plus job ID; duplicate active provider request returns `409 Conflict` plus active job ID.
- Do not expose Redis, stack traces, credentials, tokens, raw exceptions, or internal endpoints to browser responses.
- Retry only classified transient provider/model/Qdrant failures, at most three total attempts, with exponential backoff. Do not retry configuration, validation, unsupported-file, or auth errors.
- Use cooperative cancellation: revoke queued tasks; running tasks finish current file then become `REVOKED`.
- Remove current provider sync SSE endpoint and frontend stream client; SSE is out of scope.
- Keep Pydantic API DTOs frozen and typed. Keep FastAPI handlers thin. Add type annotations to every Python signature.
- Redis service stays private to Compose network; no host `ports` mapping.
- Leave changes uncommitted unless user explicitly asks for a commit.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `backend/app/services/runtime.py` | Builds settings-derived clients, ingestion service, Qdrant store, and provider registry for both API and Celery worker process. |
| `backend/app/tasks/celery_app.py` | Creates configured Celery application from settings and declares serializer, backend, retry, heartbeat, expiry, and time-limit policy. |
| `backend/app/tasks/job_store.py` | Redis repository for provider locks, task ID lookup, cancellation flags, and safe immutable job progress. |
| `backend/app/tasks/sync_tasks.py` | Celery task: dependency creation, scheduler execution, progress reporting, retry classification, cancellation, and lock cleanup. |
| `backend/app/storage/scheduler.py` | Accepts external cancellation predicate and invokes it before each file / destructive delete phase. |
| `backend/app/api/schemas/admin.py` | Frozen public schemas for job start, conflict detail, progress, and status response. |
| `backend/app/api/routes/admin/sync.py` | Thin enqueue/status/stop handlers; removes stream handler. |
| `backend/app/main.py` | Creates API service graph through shared runtime factory and injects queue/job store into app state. |
| `backend/app/config.py` | Validates Celery/Redis URLs, worker concurrency, TTL, and task time limits. |
| `frontend/src/types.ts` | Mirrors queue start and safe job status API response shapes. |
| `frontend/src/api/client.ts` | Starts sync, fetches job status, stops sync; removes SSE parser/client. |
| `frontend/src/components/AdminPage.tsx` | Tracks active provider job IDs and polls at three seconds until terminal state. |
| `docker-compose.yml`, `.env.example`, `pyproject.toml`, `uv.lock` | Redis and worker services, required configuration, Celery/Redis dependencies and locked versions. |

## Task 1: Add validated queue settings and Compose runtime

**Files:**
- Modify: `pyproject.toml:5-20`
- Modify: `uv.lock`
- Modify: `backend/app/config.py:52-93`
- Modify: `.env.example:1-34`
- Modify: `docker-compose.yml:1-66`
- Modify: `backend/tests/unit/test_config.py`
- Modify: `backend/tests/integration/test_compose_files.py:8-95`

**Interfaces:**
- Produces `Settings.CELERY_BROKER_URL: str`, `Settings.CELERY_RESULT_BACKEND: str`, `Settings.CELERY_WORKER_CONCURRENCY: int`, `Settings.CELERY_RESULT_EXPIRES_SECONDS: int`, `Settings.CELERY_TASK_SOFT_TIME_LIMIT_SECONDS: int`, and `Settings.CELERY_TASK_TIME_LIMIT_SECONDS: int`.
- Produces Compose services `redis` and `celery-worker`; later task configures worker command `backend.app.tasks.celery_app:celery_app`.

- [ ] **Step 1: Write failing settings and Compose tests**

```python
@pytest.mark.unit
def test_settings_default_worker_queue_values_are_bounded() -> None:
    settings = Settings(_env_file=None, **required_settings())

    assert settings.CELERY_WORKER_CONCURRENCY == 4
    assert settings.CELERY_RESULT_EXPIRES_SECONDS == 24 * 60 * 60
    assert settings.CELERY_TASK_SOFT_TIME_LIMIT_SECONDS < settings.CELERY_TASK_TIME_LIMIT_SECONDS


@pytest.mark.unit
@pytest.mark.parametrize("field,value", [("CELERY_WORKER_CONCURRENCY", 0), ("CELERY_RESULT_EXPIRES_SECONDS", 0)])
def test_settings_reject_non_positive_queue_values(field: str, value: int) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, **(required_settings() | {field: value}))
```

```python
def test_compose_defines_private_redis_and_worker() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())

    assert "redis" in compose["services"]
    assert "celery-worker" in compose["services"]
    assert "ports" not in compose["services"]["redis"]
    assert compose["services"]["celery-worker"]["command"] == [
        ".venv/bin/celery", "-A", "backend.app.tasks.celery_app:celery_app",
        "worker", "--loglevel=INFO", "--concurrency=${CELERY_WORKER_CONCURRENCY:-4}",
    ]
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_config.py backend/tests/integration/test_compose_files.py -v`

Expected: FAIL because queue settings and Compose services do not exist.

- [ ] **Step 3: Add dependencies and validated settings**

Add runtime dependencies, then refresh lock file:

```toml
dependencies = [
    # existing dependencies
    "celery[redis]>=5.4,<6",
    "redis>=5.2,<6",
]
```

Add frozen settings with explicit safe defaults and validation:

```python
CELERY_BROKER_URL: str = "redis://redis:6379/0"
CELERY_RESULT_BACKEND: str = "redis://redis:6379/1"
CELERY_WORKER_CONCURRENCY: int = Field(default=4, gt=0, le=32)
CELERY_RESULT_EXPIRES_SECONDS: int = Field(default=24 * 60 * 60, gt=0)
CELERY_TASK_SOFT_TIME_LIMIT_SECONDS: int = Field(default=3_300, gt=0)
CELERY_TASK_TIME_LIMIT_SECONDS: int = Field(default=3_600, gt=0)
```

Extend model validator to reject soft time limit greater than or equal to hard time limit. Add queue variables and comments to `.env.example`; URL values remain blank in host-only setups and Compose supplies private network defaults.

Add Compose `redis` using pinned `redis:7.4-alpine`, a healthcheck, no `ports`, and a named volume. Add `celery-worker` built from `.` using same `env_file` and environment map as `app`, `depends_on` Redis health plus Qdrant health, and worker command shown in test. Configure Docker JSON log rotation on `app` and `celery-worker`:

```yaml
logging:
  driver: local
  options:
    max-size: "10m"
    max-file: "3"
```

Run `uv lock` after modifying `pyproject.toml`.

- [ ] **Step 4: Run focused tests and static checks**

Run: `uv run pytest backend/tests/unit/test_config.py backend/tests/integration/test_compose_files.py -v && uv run ruff check backend/app/config.py backend/tests/unit/test_config.py backend/tests/integration/test_compose_files.py && docker compose config --quiet`

Expected: PASS. Compose renders without publishing Redis port.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add pyproject.toml uv.lock backend/app/config.py .env.example docker-compose.yml backend/tests/unit/test_config.py backend/tests/integration/test_compose_files.py
git commit -m "feat: configure Celery Redis runtime"
```

## Task 2: Extract shared process-local runtime factory

**Files:**
- Create: `backend/app/services/runtime.py`
- Modify: `backend/app/main.py:52-195`
- Create: `backend/tests/unit/test_runtime.py`
- Modify: `backend/tests/integration/test_routes.py`

**Interfaces:**
- Consumes: `Settings` and existing client/store constructors.
- Produces:

```python
@dataclass(frozen=True)
class RuntimeDependencies:
    settings: Settings
    ingestion_service: FileIngestionService
    health_dependencies: HealthDependencies
    provider_registry: ProviderRegistry
    tag_settings_store: TagSettingsStore


def build_runtime_dependencies(settings: Settings) -> RuntimeDependencies: ...
```

- `create_app()` continues to accept existing injected test dependencies and uses `build_runtime_dependencies(Settings())` only when service dependencies are not injected.

- [ ] **Step 1: Write failing runtime factory tests**

```python
@pytest.mark.unit
def test_build_runtime_dependencies_reuses_single_qdrant_store(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = make_settings()
    qdrant = Mock()
    monkeypatch.setattr(runtime, "QdrantEmbeddingStore", lambda _: qdrant)

    dependencies = runtime.build_runtime_dependencies(settings)

    assert dependencies.health_dependencies.qdrant_store is qdrant
    assert dependencies.provider_registry.get(StorageProvider.DROPBOX) is not None
```

```python
@pytest.mark.integration
def test_create_app_builds_runtime_once_on_lifespan(monkeypatch: pytest.MonkeyPatch) -> None:
    dependencies = fake_runtime_dependencies()
    build = Mock(return_value=dependencies)
    monkeypatch.setattr("backend.app.main.build_runtime_dependencies", build)

    with TestClient(create_app()) as client:
        assert client.get("/health").status_code == 200

    build.assert_called_once()
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_runtime.py backend/tests/integration/test_routes.py -k 'runtime or lifespan' -v`

Expected: FAIL because runtime module and factory do not exist.

- [ ] **Step 3: Implement focused immutable runtime factory**

```python
@dataclass(frozen=True)
class RuntimeDependencies:
    settings: Settings
    ingestion_service: FileIngestionService
    health_dependencies: HealthDependencies
    provider_registry: ProviderRegistry
    tag_settings_store: TagSettingsStore


def build_runtime_dependencies(settings: Settings) -> RuntimeDependencies:
    description_client = InstructorImageDescriptionClient(...)
    model_client = OpenAICompatibleModelClient(settings)
    qdrant_store = QdrantEmbeddingStore(settings)
    ingestion_service = FileIngestionService(...)
    return RuntimeDependencies(
        settings=settings,
        ingestion_service=ingestion_service,
        health_dependencies=HealthDependencies(...),
        provider_registry=build_provider_registry(settings, ingestion_service, qdrant_store),
        tag_settings_store=TagSettingsStore.from_settings(settings),
    )
```

Move existing Settings-derived construction from `create_app` into this factory. Keep `effective_service` injection path intact for tests. API lifespan calls `startup()` and `ensure_collection()` exactly once after constructing/injecting dependencies. Do not put runtime global objects in module scope: worker and API must own independent process-local clients.

- [ ] **Step 4: Run tests and style checks**

Run: `uv run pytest backend/tests/unit/test_runtime.py backend/tests/integration/test_routes.py -k 'runtime or lifespan' -v && uv run ruff format --check backend/app/services/runtime.py backend/app/main.py && uv run ruff check backend/app/services/runtime.py backend/app/main.py`

Expected: PASS.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add backend/app/services/runtime.py backend/app/main.py backend/tests/unit/test_runtime.py backend/tests/integration/test_routes.py
git commit -m "refactor: share application runtime construction"
```

## Task 3: Build Redis job repository and safe queue DTOs

**Files:**
- Create: `backend/app/tasks/job_store.py`
- Create: `backend/tests/unit/test_job_store.py`
- Modify: `backend/app/api/schemas/admin.py:1-37`

**Interfaces:**
- Produces immutable internal DTOs and repository protocol:

```python
class SyncJobProgress(TypedDict):
    provider: str
    state: str
    attempt: int
    phase: str | None
    upserted: int
    deleted: int
    unchanged: int
    failed: int
    cancellation_requested: bool
    detail: str | None

class SyncJobStore(Protocol):
    def acquire_provider_job(self, provider: str, job_id: str) -> str | None: ...
    def get_provider_job_id(self, provider: str) -> str | None: ...
    def release_provider_job(self, provider: str, job_id: str) -> None: ...
    def request_cancellation(self, provider: str, job_id: str) -> None: ...
    def is_cancellation_requested(self, provider: str, job_id: str) -> bool: ...
    def write_progress(self, job_id: str, progress: SyncJobProgress) -> None: ...
    def read_progress(self, job_id: str) -> SyncJobProgress | None: ...
```

- Produces frozen public schemas `AdminSyncQueuedResponse`, `AdminSyncConflictResponse`, and `AdminSyncJobStatusResponse`.

- [ ] **Step 1: Write failing repository and schema tests**

Use `fakeredis.FakeRedis(decode_responses=True)` or a tiny protocol-compatible fake; add `fakeredis>=2.26,<3` to dev dependencies if direct redis command semantics need coverage.

```python
@pytest.mark.unit
def test_acquire_provider_job_returns_existing_id_without_overwriting() -> None:
    store = RedisSyncJobStore(FakeRedis(decode_responses=True), ttl_seconds=86_400)

    assert store.acquire_provider_job("dropbox", "job-1") is None
    assert store.acquire_provider_job("dropbox", "job-2") == "job-1"
    assert store.get_provider_job_id("dropbox") == "job-1"


@pytest.mark.unit
def test_release_only_removes_lock_owned_by_same_job() -> None:
    store = RedisSyncJobStore(FakeRedis(decode_responses=True), ttl_seconds=86_400)
    store.acquire_provider_job("dropbox", "job-1")

    store.release_provider_job("dropbox", "job-2")

    assert store.get_provider_job_id("dropbox") == "job-1"
```

```python
@pytest.mark.unit
def test_progress_round_trip_excludes_raw_exception_text() -> None:
    store = RedisSyncJobStore(FakeRedis(decode_responses=True), ttl_seconds=86_400)
    progress: SyncJobProgress = {
        "provider": "dropbox", "state": "FAILURE", "attempt": 3,
        "phase": None, "upserted": 0, "deleted": 0, "unchanged": 0,
        "failed": 1, "cancellation_requested": False,
        "detail": "Provider sync failed",
    }

    store.write_progress("job-1", progress)

    assert store.read_progress("job-1") == progress
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_job_store.py -v`

Expected: FAIL because `backend.app.tasks.job_store` and DTOs do not exist.

- [ ] **Step 3: Implement Redis keys, atomic locking, and safe schemas**

Use namespaced keys:

```text
sync-job:provider:{provider}:active
sync-job:{job_id}:progress
sync-job:{job_id}:cancel
```

Implement first lock write with Redis `SET key job_id NX EX ttl`. Return existing ID if lock acquisition fails. Use compare-and-delete with a Lua script or Redis transaction/watch so one job cannot release a newer job lock. Apply the 86,400-second TTL to lock, progress, and cancellation keys. Renew task-owned lock/progress TTL on each progress update to avoid expiry during long work.

Keep progress JSON-only and validate values via frozen Pydantic schema at public boundary. Define terminal state set `{"SUCCESS", "FAILURE", "REVOKED"}`. Public schema fields are provider, state, attempt, phase, counts, cancellation flag, and safe optional detail; omit filename, raw trace, exception, Redis key, and task kwargs.

- [ ] **Step 4: Run tests and lint**

Run: `uv run pytest backend/tests/unit/test_job_store.py -v && uv run ruff format --check backend/app/tasks/job_store.py backend/app/api/schemas/admin.py && uv run ruff check backend/app/tasks/job_store.py backend/app/api/schemas/admin.py`

Expected: PASS.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add backend/app/tasks/job_store.py backend/app/api/schemas/admin.py backend/tests/unit/test_job_store.py pyproject.toml uv.lock
git commit -m "feat: add Redis-backed sync job state"
```

## Task 4: Add Celery app, cooperative scheduler cancellation, and sync task

**Files:**
- Create: `backend/app/tasks/__init__.py`
- Create: `backend/app/tasks/celery_app.py`
- Create: `backend/app/tasks/sync_tasks.py`
- Modify: `backend/app/storage/scheduler.py:65-145`
- Create: `backend/tests/unit/test_sync_tasks.py`
- Modify: `backend/tests/unit/test_storage_scheduler.py:120-202`

**Interfaces:**
- Consumes `build_runtime_dependencies(settings)` from Task 2 and `SyncJobStore` from Task 3.
- Produces:

```python
celery_app: Celery

def sync_provider(self: Task, provider: str) -> SyncJobProgress: ...

def is_transient_sync_error(error: Exception) -> bool: ...
```

- Extends scheduler entry point without breaking existing caller:

```python
async def tick_once(
    self,
    observer: Callable[[SyncTraceItem], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> SyncTickResult: ...
```

- [ ] **Step 1: Write failing scheduler and task tests**

```python
@pytest.mark.unit
@pytest.mark.asyncio
async def test_scheduler_stops_before_next_file_when_external_cancellation_is_requested() -> None:
    scheduler = make_scheduler(files=[_file("first"), _file("second")])
    checks = iter([False, True])

    result = await scheduler.tick_once(should_cancel=lambda: next(checks))

    assert result.upserted == 1
    assert [item.storage_file_id for item in scheduler.ingestion.uploads] == ["first"]
```

```python
@pytest.mark.unit
def test_sync_task_retries_classified_transient_qdrant_error(mocker: MockerFixture) -> None:
    task = sync_provider
    task.retry = Mock(side_effect=Retry())
    mocker.patch("backend.app.tasks.sync_tasks.run_provider_sync", side_effect=QdrantStorageError("temporary unavailable"))

    with pytest.raises(Retry):
        task.run("dropbox")

    task.retry.assert_called_once_with(exc=ANY, countdown=ANY, max_retries=2)
```

```python
@pytest.mark.unit
def test_sync_task_marks_running_cancelled_job_revoked_and_releases_lock(mocker: MockerFixture) -> None:
    store = Mock(spec=SyncJobStore)
    store.is_cancellation_requested.return_value = True
    mocker.patch("backend.app.tasks.sync_tasks.build_job_store", return_value=store)

    result = sync_provider.run("dropbox")

    assert result["state"] == "REVOKED"
    store.release_provider_job.assert_called_once_with("dropbox", ANY)
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_storage_scheduler.py backend/tests/unit/test_sync_tasks.py -v`

Expected: FAIL because task module, cancellation callback, and retry behavior do not exist.

- [ ] **Step 3: Implement Celery and task behavior**

Configure Celery from `Settings`:

```python
celery_app = Celery("asset_tracker")
celery_app.conf.update(
    broker_url=settings.CELERY_BROKER_URL,
    result_backend=settings.CELERY_RESULT_BACKEND,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    result_expires=settings.CELERY_RESULT_EXPIRES_SECONDS,
    worker_send_task_events=True,
    task_send_sent_event=True,
    task_acks_late=True,
    task_soft_time_limit=settings.CELERY_TASK_SOFT_TIME_LIMIT_SECONDS,
    task_time_limit=settings.CELERY_TASK_TIME_LIMIT_SECONDS,
)
```

Do not use Celery heartbeat as status transport; worker event heartbeat is worker-health instrumentation only.

Update scheduler internals to check `should_cancel()` before starting each file and before deletion phase. Preserve existing in-process `threading.Event` cancellation behavior by using a local helper that ORs both cancellation sources. Current file remains uninterrupted once indexing starts. Emit existing safe `sync_cancel` trace when cancellation becomes effective.

Task details:

- Bind task so `self.request.id` is job ID and `self.request.retries` is attempt metadata.
- Create `Settings`, `RedisSyncJobStore`, and runtime dependencies inside task process.
- Validate provider and enabled scheduler; permanent setup failures record safe `FAILURE`, release matching lock, and raise no retry.
- Map scheduler observer traces to safe phases/counts. Never persist raw trace detail or filename.
- Before task processing, write `STARTED` progress. During work write progress with refreshed TTL.
- On external cancellation, write `REVOKED`, return safe progress, and release matching lock.
- Retry only exact categorized temporary errors. Use `self.retry(exc=error, countdown=2 ** self.request.retries, max_retries=2)`; this yields three total attempts. Write `RETRY` safe state before retrying. Do not retry generic `Exception`.
- On exhausted retry or permanent error, log with `logger.exception` and job/provider/attempt context; write `FAILURE` with detail `"Provider sync failed"`; release matching lock.
- On success, write `SUCCESS` with result counts; refresh provider health in worker process; release matching lock in `finally` only for terminal outcomes.

Use a narrow task-level `run_provider_sync` helper so tests can inject fake runtime/scheduler without a broker.

- [ ] **Step 4: Run focused tests and full scheduler regression suite**

Run: `uv run pytest backend/tests/unit/test_storage_scheduler.py backend/tests/unit/test_sync_tasks.py -v && uv run ruff format --check backend/app/tasks backend/app/storage/scheduler.py && uv run ruff check backend/app/tasks backend/app/storage/scheduler.py`

Expected: PASS. Existing scheduler cancellation tests remain green.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add backend/app/tasks backend/app/storage/scheduler.py backend/tests/unit/test_storage_scheduler.py backend/tests/unit/test_sync_tasks.py
git commit -m "feat: run provider sync in Celery workers"
```

## Task 5: Replace synchronous admin sync route with queue APIs

**Files:**
- Modify: `backend/app/main.py:52-195`
- Modify: `backend/app/api/routes/admin/sync.py:1-234`
- Modify: `backend/app/api/schemas/admin.py:1-37`
- Modify: `backend/tests/integration/test_admin_routes.py:265-454`
- Create: `backend/tests/integration/test_admin_sync_jobs.py`

**Interfaces:**
- Consumes `SyncJobStore` Task 3, `sync_provider.apply_async(args=(provider,))` Task 4, and public response schemas Task 3.
- Produces endpoint contracts:

```text
POST /admin/sync/{provider} -> 202 AdminSyncQueuedResponse
GET /admin/sync-jobs/{job_id} -> 200 AdminSyncJobStatusResponse
POST /admin/sync/{provider}/stop -> 200 AdminSyncStopResponse
```

- Removes `POST /admin/sync/{provider}/stream` and `ProviderSyncStream` dependency from route.

- [ ] **Step 1: Write failing API integration tests**

Inject fake `SyncJobStore` and fake Celery dispatcher through `create_app` parameter or exact state dependencies; do not connect tests to a real Redis server.

```python
@pytest.mark.integration
def test_start_sync_enqueues_provider_and_returns_accepted_job_id(client: TestClient) -> None:
    response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})

    assert response.status_code == 202
    assert response.json() == {
        "job_id": "job-1", "provider": "dropbox", "state": "PENDING"
    }
```

```python
@pytest.mark.integration
def test_start_duplicate_provider_sync_returns_conflict_with_active_job(client: TestClient) -> None:
    client.app.state.sync_job_store.acquire_provider_job.return_value = "job-active"

    response = client.post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})

    assert response.status_code == 409
    assert response.json() == {
        "detail": "Dropbox sync already running", "job_id": "job-active"
    }
```

```python
@pytest.mark.integration
def test_job_status_returns_only_safe_progress(client: TestClient) -> None:
    client.app.state.sync_job_store.read_progress.return_value = safe_progress("STARTED")

    response = client.get("/admin/sync-jobs/job-1")

    assert response.status_code == 200
    assert response.json()["state"] == "STARTED"
    assert "traceback" not in response.text
    assert "filename" not in response.text
```

```python
@pytest.mark.integration
def test_stop_requests_cancellation_for_running_provider_job(client: TestClient) -> None:
    client.app.state.sync_job_store.get_provider_job_id.return_value = "job-1"

    response = client.post("/admin/sync/dropbox/stop", headers={"Origin": TEST_ORIGIN})

    assert response.status_code == 200
    assert response.json() == {"provider": "dropbox", "status": "stopping"}
    client.app.state.sync_job_store.request_cancellation.assert_called_once_with("dropbox", "job-1")
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py backend/tests/integration/test_admin_sync_jobs.py -v`

Expected: FAIL because old route blocks on scheduler, job route does not exist, and stop uses API-local scheduler.

- [ ] **Step 3: Implement thin queue routes and app injection**

Add injectable queue dependencies to `create_app`, mirroring existing optional service/registry injection pattern:

```python
def create_app(
    ...,
    sync_job_store: SyncJobStore | None = None,
    sync_task_dispatcher: SyncTaskDispatcher | None = None,
) -> FastAPI: ...
```

At normal startup, construct `RedisSyncJobStore` from configured Redis client and production dispatcher around `sync_provider.apply_async`. Store both in `application.state`. In tests inject fakes.

Start handler order:

1. Validate provider and configured scheduler using existing helpers.
2. Run `_require_available_embedding_model(request)` before enqueueing.
3. Generate task ID (`uuid4().hex`) before lock attempt.
4. Call `store.acquire_provider_job(provider, task_id)`.
5. On existing active ID, return `409` response with existing ID.
6. Dispatch with supplied task ID so Celery and provider lock use same ID.
7. If dispatch raises, release matching lock and return safe `503` without exposing broker error.
8. Return `AdminSyncQueuedResponse(job_id=task_id, provider=provider, state="PENDING")` and `202`.

Status handler reads safe progress from store, falling back to Celery `AsyncResult` only to translate known Celery state without revealing backend result. Unknown/expired job gives `404`.

Stop handler finds active provider task. For queued `PENDING`, call Celery revoke without termination, write cancellation request, and release matching lock; return `stopping`. For started/retry task, set cancellation request and return `stopping`. Return `unavailable` only when no active provider job exists. Do not inspect or mutate API-process scheduler.

Delete stream route, related imports, `ProviderSyncStream` module and SSE route tests because queue delivery intentionally uses polling.

- [ ] **Step 4: Run tests, HTTP route checks, and lint**

Run: `uv run pytest backend/tests/integration/test_admin_routes.py backend/tests/integration/test_admin_sync_jobs.py -v && uv run ruff format --check backend/app/main.py backend/app/api/routes/admin/sync.py backend/app/api/schemas/admin.py && uv run ruff check backend/app/main.py backend/app/api/routes/admin/sync.py backend/app/api/schemas/admin.py`

Expected: PASS. Auth and cross-origin tests still reject requests before queue operations.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add backend/app/main.py backend/app/api/routes/admin/sync.py backend/app/api/schemas/admin.py backend/tests/integration/test_admin_routes.py backend/tests/integration/test_admin_sync_jobs.py backend/app/admin_dashboard/sync_stream.py backend/tests/unit/test_admin_sync_stream.py
git commit -m "feat: expose queued provider sync API"
```

## Task 6: Replace SSE frontend behavior with status polling

**Files:**
- Modify: `frontend/src/types.ts:63-142`
- Modify: `frontend/src/api/client.ts:1-244`
- Modify: `frontend/src/components/AdminPage.tsx:1-426`
- Modify: `frontend/src/api/client.test.ts`
- Modify: `frontend/src/components/AdminPage.test.tsx:1-416`

**Interfaces:**
- Consumes backend response types from Task 5.
- Produces:

```ts
export type AdminSyncQueuedResponse = {
  readonly job_id: string;
  readonly provider: string;
  readonly state: "PENDING";
};

export type AdminSyncJobStatusResponse = {
  readonly job_id: string;
  readonly provider: string;
  readonly state: "PENDING" | "STARTED" | "RETRY" | "SUCCESS" | "FAILURE" | "REVOKED";
  readonly attempt: number;
  readonly phase: string | null;
  readonly upserted: number;
  readonly deleted: number;
  readonly unchanged: number;
  readonly failed: number;
  readonly cancellation_requested: boolean;
  readonly detail: string | null;
};

export function triggerAdminSync(provider: string): Promise<AdminSyncQueuedResponse>;
export function getAdminSyncJob(jobId: string): Promise<AdminSyncJobStatusResponse>;
```

- [ ] **Step 1: Write failing client and component tests**

```ts
test("starts sync then fetches queue job status with session credentials", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(jsonResponse({ job_id: "job-1", provider: "dropbox", state: "PENDING" }, 202))
    .mockResolvedValueOnce(jsonResponse(jobStatus("STARTED"), 200));
  vi.stubGlobal("fetch", fetchMock);

  await triggerAdminSync("dropbox");
  await getAdminSyncJob("job-1");

  expect(fetchMock).toHaveBeenNthCalledWith(1, "/admin/sync/dropbox", expect.objectContaining({ method: "POST", credentials: "include" }));
  expect(fetchMock).toHaveBeenNthCalledWith(2, "/admin/sync-jobs/job-1", expect.objectContaining({ credentials: "include" }));
});
```

```tsx
test("polls queued sync every three seconds then refreshes dashboard on success", async () => {
  vi.useFakeTimers();
  mockedTriggerAdminSync.mockResolvedValue({ job_id: "job-1", provider: "google_drive", state: "PENDING" });
  mockedGetAdminSyncJob
    .mockResolvedValueOnce(jobStatus("STARTED"))
    .mockResolvedValueOnce(jobStatus("SUCCESS"));

  render(<AdminPage />);
  await userEvent.setup({ advanceTimers: vi.advanceTimersByTimeAsync }).click(await screen.findByRole("button", { name: "Sync Google Drive" }));
  await vi.advanceTimersByTimeAsync(3_000);
  await vi.advanceTimersByTimeAsync(3_000);

  expect(mockedGetAdminSyncJob).toHaveBeenCalledTimes(2);
  expect(mockedGetAdminSyncStatus).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
```

```tsx
test("adopts active job after duplicate sync conflict", async () => {
  mockedTriggerAdminSync.mockRejectedValue(new ApiError(409, JSON.stringify({ job_id: "job-active" })));
  mockedGetAdminSyncJob.mockResolvedValue(jobStatus("STARTED", "job-active"));

  render(<AdminPage />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Sync Dropbox" }));

  await waitFor(() => expect(mockedGetAdminSyncJob).toHaveBeenCalledWith("job-active"));
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd frontend && npm test -- --run src/api/client.test.ts src/components/AdminPage.test.tsx`

Expected: FAIL because client still uses streaming and no job-status API/types exist.

- [ ] **Step 3: Implement typed queue client and component polling**

Delete `streamAdminSync`, `SyncEvent`, `SyncActivityEvent`, `SyncTerminalEvent`, `AbortController` ref, incremental fake activity UI behavior, and SSE parser tests. Preserve existing activity panel only if it can display safe phase/count summary; otherwise remove panel imports/rendering rather than inventing per-file events not supplied by polling API.

Implement fetch helper:

```ts
export function getAdminSyncJob(jobId: string): Promise<AdminSyncJobStatusResponse> {
  return adminRequest(`/admin/sync-jobs/${encodeURIComponent(jobId)}`);
}
```

Improve `parseError` so a 409 JSON response with `job_id` can be represented by `ApiError` carrying typed optional conflict data, rather than parsing message JSON in component:

```ts
export class ApiError extends Error {
  public readonly status: number;
  public readonly jobId: string | undefined;

  constructor(status: number, message: string, jobId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.jobId = jobId;
  }
}
```

Admin state holds immutable provider-to-job map:

```ts
type ActiveSyncJobs = Readonly<Record<string, string>>;
const [activeSyncJobs, setActiveSyncJobs] = useState<ActiveSyncJobs>({});
```

Implement a `useEffect` keyed by active jobs. For every active job, call `getAdminSyncJob` immediately then every `3_000` ms. Use `window.setInterval`; cleanup with `window.clearInterval` on effect rerun/unmount. Terminal states remove only that provider job immutably. On `SUCCESS`, refresh dashboard once. On `FAILURE`, show `detail ?? SAFE_SYNC_ERROR`. On `REVOKED`, show non-error stopped status. On `404`, remove stale ID and show safe expired-status message. Do not leak an interval after login state changes or component unmount.

Start action calls `triggerAdminSync`; set active provider job from response. On `409` with `jobId`, set active provider job to existing job and poll it. Stop action calls existing `stopAdminSync` but retains active job until polling observes terminal/revoked status; do not falsely clear button state immediately.

- [ ] **Step 4: Run frontend tests, type check, and production build**

Run: `cd frontend && npm test -- --run src/api/client.test.ts src/components/AdminPage.test.tsx && npm run typecheck && npm run build`

Expected: PASS. No `streamAdminSync` import or SSE parsing remains.

- [ ] **Step 5: Commit only if explicitly authorized**

```bash
git add frontend/src/types.ts frontend/src/api/client.ts frontend/src/components/AdminPage.tsx frontend/src/api/client.test.ts frontend/src/components/AdminPage.test.tsx
git commit -m "feat: poll queued provider sync jobs"
```

## Task 7: Verify worker-to-API flow and Compose deployment

**Files:**
- Create: `backend/tests/integration/test_celery_sync_flow.py`
- Modify: `backend/tests/integration/test_compose_files.py`
- Modify: `README.md` or existing deployment documentation that explains manual provider sync

**Interfaces:**
- Consumes Task 1 Compose topology, Task 4 task behavior, Task 5 endpoint contract, Task 6 frontend polling contract.
- Produces documented local commands and verified 24-hour result/lock cleanup behavior.

- [ ] **Step 1: Write failing end-to-end boundary tests**

Use Celery eager mode only for task dispatch boundary and fake Redis/job store for no-external-service CI test. Keep broker-specific behavior in job-store tests.

```python
@pytest.mark.integration
def test_enqueued_sync_publishes_success_status_and_releases_provider_lock(app: FastAPI) -> None:
    store = app.state.sync_job_store
    response = authenticated_client(app).post("/admin/sync/dropbox", headers={"Origin": TEST_ORIGIN})
    job_id = response.json()["job_id"]

    status_response = authenticated_client(app).get(f"/admin/sync-jobs/{job_id}")

    assert response.status_code == 202
    assert status_response.json()["state"] == "SUCCESS"
    assert store.get_provider_job_id("dropbox") is None
```

```python
def test_compose_worker_and_api_share_queue_configuration() -> None:
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text())
    app_env = compose["services"]["app"]["environment"]
    worker_env = compose["services"]["celery-worker"]["environment"]

    for name in ("CELERY_BROKER_URL", "CELERY_RESULT_BACKEND", "QDRANT_URL"):
        assert worker_env[name] == app_env[name]
```

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/integration/test_celery_sync_flow.py backend/tests/integration/test_compose_files.py -v`

Expected: FAIL until task result, lock lifecycle, and service config are fully wired.

- [ ] **Step 3: Complete wiring gaps found by tests and document local operation**

Document exact development workflow:

```bash
cp .env.example .env
# Fill required model, Qdrant, admin, and provider configuration.
docker compose up --build
# API: http://localhost:8000; worker logs:
docker compose logs -f celery-worker
```

Document expected admin flow: `POST /admin/sync/{provider}` returns job ID; frontend polls; job status expires after 24 hours; logs reside in worker container logs under configured rotation; worker heartbeat only signals worker availability. State that Redis is internal and must not be exposed publicly.

Ensure backend package discovery includes new `backend.app.tasks` directory through existing `backend*` package pattern.

- [ ] **Step 4: Run full verification**

Run:

```bash
uv run pytest backend/tests -v
uv run pytest --cov=backend/app --cov-report=term-missing
uv run ruff format --check backend
uv run ruff check backend
cd frontend && npm test -- --run && npm run typecheck && npm run build
cd .. && docker compose config --quiet
git diff --check
```

Expected: all tests and checks PASS; coverage remains at or above 80%; Compose validates; no whitespace errors.

- [ ] **Step 5: Manually verify local container behavior**

Run:

```bash
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 celery-worker
curl -fsS http://localhost:8000/health
docker compose down
```

Expected: Redis remains unbound to host, API health succeeds, worker stays running at configured concurrency, and shutdown completes cleanly.

- [ ] **Step 6: Commit only if explicitly authorized**

```bash
git add backend/tests/integration/test_celery_sync_flow.py backend/tests/integration/test_compose_files.py README.md
git commit -m "test: verify queued provider sync deployment"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1–7 cover Redis broker/result/TTL, worker runtime and concurrency, provider locks, 202/409/status/stop APIs, status polling, safe cancellation, classified retry, safe error handling, log retention, worker heartbeat distinction, private Compose Redis, unit/integration/frontend/E2E coverage, and documentation.
- **Intentional scope exclusions:** No SSE job stream, job-history database, scheduled sync, or unrelated admin queueing.
- **Type consistency:** `SyncJobProgress` is internal `TypedDict`; `AdminSyncJobStatusResponse` is frozen public Pydantic DTO; TypeScript mirrors only public fields. Task ID passes unchanged through lock, Celery dispatch, polling response, and stop behavior.
- **Placeholder scan:** No TBD/TODO/implementation-later markers. All code steps name concrete interfaces, response states, tests, and commands.
