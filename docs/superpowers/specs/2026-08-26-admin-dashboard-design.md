# Admin Dashboard Revamp Design

## Purpose

Replace current admin provider-control page with compact dark graphite dashboard. Admin sees current per-provider file inventory, Qdrant metadata record count, provider health, model health, manual refresh, and live sync activity.

## Scope

Dashboard remains behind existing admin session protection. Existing provider sync and reindex behavior remain available.

Dashboard contains:

- **Storage providers**: responsive cards, one card per registered provider.
- Each provider card shows display name, health badge, **Detected** count, **Embedded** count, **Refresh**, and **Sync**.
- **Detected**: count of files discovered in that provider's configured root.
- **Embedded**: count of Qdrant records scoped to provider metadata. Dashboard reads payload metadata only; it never requests or returns vectors or file contents.
- Disabled providers retain a card, report unavailable/not configured health, show unavailable counts, and have disabled Sync.
- **Model health**: compact cards after provider cards. Each shows role, configured model name, and health badge for embedding and description models.

## Visual Design

Use approved mockup in `admin-dashboard-mockup.html` as visual reference.

- Neutral graphite page and card surfaces.
- Slate text and borders.
- Blue for ready status and Embedded count.
- Amber for warning status, keyboard focus, and in-progress sync state.
- Inter for UI text; IBM Plex Mono for status and data labels.
- No charts, provider descriptions, endpoint URLs, credentials, vectors, or file contents.

## Refresh Behavior

Each provider card has independent Refresh action.

Refresh does not ingest, embed, delete, or modify data. It rechecks:

1. Provider health.
2. Detected file count from provider root.
3. Embedded Qdrant metadata-record count scoped to provider.
4. Embedding and description model health.

Refresh affects only selected provider inventory/status plus global model-health cards. While Refresh runs, only selected Refresh button shows `Refreshing…` and is disabled. All Sync buttons remain available.

## Sync Behavior

Each provider card has independent Sync action.

Sync executes existing provider ingestion flow. Two or more providers may sync concurrently; starting one sync never disables Sync or Refresh actions on another provider.

When a provider sync starts:

1. Its Sync button changes to `Syncing…` and is disabled for that provider only.
2. Its activity panel opens below its own card.
3. Other provider cards retain their normal height until their own activity panel opens.
4. Each file emits ordered visible status events: loading, embedding when applicable, done, or failed.
5. When sync ends, selected provider Sync button returns to `Sync`; final counts refresh for that provider.

Sync failure stays isolated to provider. Failed file rows show a safe user-facing status; server logs retain technical cause. A failed provider sync does not stop concurrent syncs or prevent other provider refreshes.

## Live Activity Transport

Live activity requires server-to-browser streaming rather than final-result-only response.

Use one authenticated provider-scoped Server-Sent Events stream per running sync. Stream begins when admin starts sync and ends after terminal provider event. Browser keeps one independent stream/controller per provider, so multiple provider syncs may run concurrently.

Event payload pseudocode:

```text
sync event:
  provider identifier
  sequence number
  filename
  activity status: loading | embedding | done | failed
  safe display detail
  terminal flag

terminal sync event:
  provider identifier
  final detected count
  final embedded count
  total completed count
  total failed count
  terminal flag
```

Events never contain file content, vectors, provider credentials, URLs, raw SDK exceptions, or stack traces. The stream disables compression. Provider work that uses synchronous storage/Qdrant SDKs runs off async event loop.

## Activity Panel

Each provider owns an independent activity panel below its card.

- Panel opens when that provider starts Sync.
- Panel shows current and completed assets, newest activity first.
- Visible list has fixed height equivalent to five asset rows.
- Remaining assets use native vertical scrolling; no pagination, horizontal range slider, or next/previous controls.
- Active file remains scrolled into view when new event arrives, unless admin manually scrolls away to inspect prior events.
- Two or more activity panels may be open and render independently at same time while their providers sync concurrently.
- Each row shows only safe filename and status.

## API and Backend Composition

Extend existing authenticated dashboard status response with:

```text
Provider status:
  provider identifier
  provider display name
  enabled flag
  provider health
  detected file count, or unavailable
  embedded metadata-record count, or unavailable
  existing last-sync details remain compatible

Model health:
  configured model name
  availability health

Dashboard status response:
  list of provider statuses
  embedding-model health
  description-model health
```

Dashboard-status service owns metric collection. It receives immutable registered-provider and model/Qdrant dependencies from app composition, not from browser input.

For enabled provider, service obtains detected count from provider configured root and embedded count from metadata-scoped Qdrant lookup. Blocking provider, Qdrant, and model health checks execute off async event loop.

If provider inventory or Qdrant count fails, service leaves only affected count unavailable, keeps rest of dashboard usable, logs internal detail, and returns no raw provider error. Existing model health checks report `Unavailable` for network failure, timeout, or absent configured model.

Description client exposes configured model name through same public capability as embedding client. Model cards never expose endpoints or credentials.

Provider configured root belongs to registry entry at app composition time. Browser cannot select arbitrary roots.

A focused sync-event broadcaster/service owns per-provider event subscription and lifecycle. Existing scheduler reports events through this service without storing mutable UI state globally. Sync handler is thin: authorize, start or join provider stream, delegate scheduler work, emit safe ordered events, clean up subscriber.

## Frontend Behavior

Update frontend response types to match added provider counts and model health. Keep existing login/session restore/error handling.

Authenticated admin page manages state independently by provider:

- cached dashboard status;
- refreshing provider identifier set;
- syncing provider map;
- activity event list per provider;
- event-stream connection per provider;
- per-panel scroll intent.

On Sync terminal event, frontend reloads dashboard status to show final counts and status. On stream connection/error, only affected provider card displays safe error and returns its button to usable state.

Remove old activity/last-sync details from primary layout. API fields remain compatible until an explicit versioned removal.

## Security

- Status, refresh, sync, and event streams require existing admin session.
- State-changing Refresh and Sync requests enforce existing approved-origin/CSRF protection.
- Streams permit same-origin authenticated connection only.
- No raw exceptions, provider URLs, configuration values, credentials, vectors, or file content reach browser.
- Apply rate limit appropriate to manual Refresh and Sync endpoints; preserve existing auth rate limit.

## Testing

TDD required.

Backend unit tests:

- enabled provider returns detected and embedded metadata counts;
- disabled provider reports unavailable counts without storage/Qdrant calls;
- provider inventory failure isolates unavailable detected count;
- Qdrant failure isolates unavailable embedded count;
- count read requests payload metadata without vectors;
- model name and Ready/Unavailable health values;
- concurrent provider syncs create isolated event streams and ordered event sequences;
- failed provider emits safe failed event then terminal event;
- stream headers disable compression.

Backend integration tests:

- authenticated status includes counts and model health;
- anonymous dashboard status and stream requests receive 401;
- wrong-origin Refresh/Sync requests receive 403;
- two providers can stream activity concurrently;
- terminal stream result updates only matching provider.

Frontend tests:

- authenticated provider cards render Detected/Embedded and model cards;
- Refresh only disables clicked provider Refresh button;
- Sync opens matching activity panel and renders incoming events;
- activity list keeps five-row viewport and scrolls extra rows;
- two provider syncs can render independent panels concurrently;
- stream failure restores only affected provider Sync button and shows safe error;
- session-expiry and login-error behavior remain intact.

Run backend targeted tests with `uv run pytest`, frontend targeted tests with `npm test -- --run`, then project formatter, lint, and typecheck commands.

## Non-goals

- No charts, trends, pending metric, provider configuration UI, endpoint URLs, secrets, vectors, file contents, Qdrant collection internals, or sync cancellation.
- No polling for sync progress.
- No change to provider ingestion/reindex semantics beyond emitting progress events.
