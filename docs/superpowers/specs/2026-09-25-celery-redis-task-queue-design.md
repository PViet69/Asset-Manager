# Celery and Redis Provider Sync Queue Design

**Date:** 2026-09-25

## Goal

Move admin-triggered provider synchronization and ingestion out of FastAPI request handling into Celery workers. Keep admin control, safe cancellation, status visibility, and existing provider-scoped behavior.

## Scope

- Queue provider sync and ingestion jobs.
- Use Redis as Celery broker, result backend, provider lock store, cancellation-signal store, and safe progress store.
- Add polling-based job status to existing admin dashboard.
- Keep existing provider stop endpoint.
- Run API, worker, and Redis as separate Docker Compose services.

Out of scope:

- SSE job-progress streaming.
- Durable job history or audit records.
- Automatic recurring sync schedules.
- Queueing unrelated admin operations.

## Decisions

| Concern | Decision |
| --- | --- |
| Queue workload | Provider sync plus ingestion |
| Delivery UI | Poll job status every 3 seconds while active |
| Result persistence | Redis only; 24-hour TTL |
| Duplicate same-provider sync | Reject with `409 Conflict` and active `job_id` |
| Retry policy | Three total attempts with exponential backoff for classified transient failures |
| Cancellation | Revoke queued jobs; running jobs safely stop between files |
| Runtime | Docker Compose Redis and separate Celery worker container |
| Worker concurrency | Configurable, default `4` |
| Existing stop API | Retain provider-scoped stop endpoint |

## Architecture

```text
Admin frontend
  | POST provider sync
  v
FastAPI API container ---- enqueue provider name ----> Redis
  | GET job status                                  |
  <----------- safe state/result -------------------+
                                                     v
                                           Celery worker (concurrency 4)
                                             | build Settings and dependencies
                                             | acquire/check provider lock
                                             | run StorageSyncScheduler
                                             | ingest files and write Qdrant
                                             v
                                 provider APIs / model service / Qdrant
```

The worker receives serializable task arguments only: provider identifier and Celery task metadata. It must never receive API-process dependency objects, schedulers, locks, clients, or request state.

API and worker both construct dependencies from the same environment settings. Extract a focused shared dependency factory from current `create_app` construction path if needed. This factory creates description client, embedding client, Qdrant store, ingestion service, and provider registry. API lifespan retains ownership of API state; worker creates and tears down its own process-local dependencies.

Reuse `StorageSyncScheduler` as sync implementation. Do not duplicate scheduler file processing in task code.

## Celery and Redis Configuration

Add a Celery application with:

- Redis broker URL and result-backend URL from required environment configuration.
- JSON task payload/result serialization only.
- `result_expires` set to 24 hours.
- Worker heartbeats enabled for worker health observability. Heartbeats do not provide job progress to frontend.
- `CELERY_WORKER_CONCURRENCY=4` default, configurable per deployment.
- Explicit task soft/hard time limits sized for provider sync workload.
- Late acknowledgement so an unclean worker loss can requeue work, with idempotent scheduler/Qdrant behavior preserved.
- Structured worker logging to stdout, including job ID, provider, attempt, terminal state, and full server-side exceptions.

Redis result data contains safe state, counts, current phase, retry metadata, cancellation state, and safe terminal error message. It never exposes stack traces, provider credentials, tokens, or internal endpoint details.

Worker logs remain in Docker container stdout/stderr. Docker Compose configures rotation limits. Redis status expiry does not determine worker-log retention.

## API Contract

Existing endpoints change behavior:

### Start sync

`POST /admin/sync/{provider}` (existing route shape retained)

1. Enforce current admin authentication, origin checks, model availability checks, and rate limiting.
2. Validate provider is known and configured.
3. Atomically acquire provider lock in Redis. Lock stores active Celery `job_id` and has a safety TTL.
4. If active lock exists, return `409 Conflict` with safe message and active `job_id`.
5. Enqueue `sync_provider(provider)`.
6. Associate Celery task ID with provider lock.
7. Return `202 Accepted` with `job_id`, provider, and initial state.

### Job status

New endpoint: `GET /admin/sync-jobs/{job_id}`.

This endpoint requires admin authentication and returns one safe status representation:

- `PENDING`
- `STARTED`
- `RETRY`
- `SUCCESS`
- `FAILURE`
- `REVOKED`

Unknown or expired job IDs return `404`. Results expire 24 hours after task completion. Status response includes provider, attempt count, safe progress counts/phase, cancellation state, and safe terminal summary where available.

### Stop sync

Keep existing `POST /admin/sync/{provider}/stop` endpoint.

- If task is queued, revoke it and clear active-provider lock.
- If task is running, write provider/job cancellation signal to Redis. Worker observes signal between files, lets current file finish, returns `REVOKED`, and clears lock.
- If no active task exists, return current established unavailable/no-op semantics.
- Terminal task cancellation is idempotent and must not alter completed result.

## Task Lifecycle

1. API starts job and records provider lock.
2. Worker reconstructs application dependencies from environment settings.
3. Task initializes safe progress state, then invokes provider scheduler.
4. Scheduler observer maps file events to safe progress updates in Redis.
5. Task checks cancellation signal between files through scheduler cancellation adapter.
6. On success, task records safe result and releases provider lock.
7. On transient error, task records retry state and retries with exponential backoff until three total attempts.
8. On permanent error or exhausted retries, task records safe failure and releases lock.
9. On revoke/cancel, task records revoked state and releases lock.

A provider lock prevents two jobs for same provider. Worker concurrency allows up to four jobs across different providers, subject to available configured providers and any future queue use.

## Failure Classification

Retry only explicitly classified transient conditions:

- Provider network failures, timeouts, temporary server errors, and rate limits.
- Model-service temporary unavailability and timeouts.
- Qdrant connection failures, timeouts, and temporary service unavailability.

Do not retry:

- Invalid or missing configuration.
- Authentication/authorization failures requiring operator action.
- Unsupported content or rejected file constraints, including oversized videos.
- Input validation failures.
- Programming errors and unexpected serialization errors, unless intentionally classified after investigation.

Retry attempts use exponential backoff. Full exception detail goes to worker logs only. API returns safe generic terminal failure detail.

## Frontend Behavior

- Sync request receives `202` and saves active `job_id` by provider in frontend state.
- Frontend polls job-status endpoint every 3 seconds while job is non-terminal.
- Page refresh can resume polling for known active job ID during current dashboard session.
- Sync button disables while its provider has active job.
- On `409`, frontend adopts returned active `job_id` and polls it rather than presenting a duplicate-start failure.
- Stop button calls retained provider stop endpoint.
- Terminal state stops polling, refreshes provider dashboard status, and renders safe summary/error.

SSE is intentionally deferred. Add it only if per-file near-real-time activity becomes product requirement.

## Files and Components

- `backend/app/tasks/celery_app.py`: Celery application and task settings.
- `backend/app/tasks/sync_tasks.py`: Provider-sync task and retry/cancellation lifecycle.
- `backend/app/tasks/job_store.py`: Redis lock, task lookup, cancel signal, safe progress and state access.
- Shared backend dependency factory: construct worker/API service graph consistently.
- `backend/app/api/routes/admin/sync.py`: queue start behavior, polling endpoint, provider stop behavior.
- `backend/app/api/schemas/admin.py`: enqueue and job-status schemas.
- `frontend/src/api/client.ts` and admin components: create/poll job status, duplicate adoption, stop behavior.
- `pyproject.toml`: Celery and Redis dependencies.
- `Dockerfile`, `docker-compose.yml`, `.env.example`: worker command, Redis service, configuration, logging and no-secrets defaults.

## Testing

### Unit tests

- Provider lock acquisition, duplicate detection, job-ID association, TTL, and cleanup.
- Safe Redis status/progress serialization and terminal state mapping.
- Cancellation signal behavior.
- Transient/permanent failure classifier and retry parameters.
- Task dependency construction, success result, retry result, failure result, revoke result, and guaranteed lock release.
- Scheduler cancellation at safe file boundary.

### Integration tests

- Start endpoint returns `202` and job ID.
- Duplicate provider request returns `409` and active job ID.
- Status endpoint returns safe state/progress and `404` for unknown/expired job.
- Existing auth, origin checks, and rate limits protect new/changed endpoints.
- Stop endpoint cancels queued and running work under expected semantics.
- No unsafe exception content enters job status response.

### Celery/Redis integration tests

- Isolated Redis-backed or Celery eager-mode suite validates message/result handling.
- Transient errors retry up to three attempts; permanent errors do not retry.
- Lock cleanup after success, exhausted failure, queued revocation, and cooperative cancellation.

### Frontend and end-to-end tests

- Poll starts, repeats at three seconds, stops at terminal state, and cleans up on component unmount.
- Duplicate `409` adopts active task.
- UI disables active provider sync and reports terminal safe result.
- Admin can start sync, observe completion, and request cancellation.

### Compose tests

- API and worker receive same required environment configuration.
- Redis is internal only, not host-published by default.
- Worker starts with configured concurrency default of four.

## Security and Operations

- Use environment variables for Redis endpoints and Celery configuration; no hardcoded credentials.
- Redis must not be exposed publicly; use service-network access and authenticated/TLS configuration in deployment environments where applicable.
- Preserve current admin authentication, allowed-origin protection, and rate limit on all job-control endpoints.
- Validate all provider/job IDs at API boundaries. Authorize every status read and stop request.
- Keep sensitive failures in structured server logs; return safe user-facing summaries only.
- Monitor worker heartbeat separately from job status. A healthy worker does not imply a specific job succeeded.
