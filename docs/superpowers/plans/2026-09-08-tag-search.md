# Categorized Approved tag filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract categorized tags from current Qdrant asset `content`, index them into each asset payload, let admins persist approved grouped tags, and let users AND-search approved tags.

**Architecture:** New focused tag indexing/settings service scrolls the main Qdrant collection, parses known category lines in `content`, writes canonical `tags` payload values on returned point IDs, and manages one persistent approved-tag record in separate settings collection. Existing vector search uses Qdrant payload filters for canonical tag AND matching. Admin UI invokes manual indexing and explicitly saves approvals; SearchPanel consumes grouped approved tags.

**Tech Stack:** FastAPI, Pydantic v2, qdrant-client, pytest, React, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-08-tag-search-design.md`

## Global Constraints

- Source tags only from labeled lines in current asset payload `content`.
- Categories: Subjects, Actions, Setting, Colors, Style, Visible text, Angles.
- Canonical tag prefixes: `subject`, `action`, `setting`, `color`, `style`, `visible_text`, `angle`.
- Canonical tag form is `<prefix>:<normalized-value>`; every selected tag requires a Qdrant payload match.
- Manual discovery always indexes/updates each asset `tags` payload before returning tag groups.
- Persist approved tags only in separate Qdrant settings collection. No SQL, cache, scheduler, or new external service.
- Preserve semantic and filename modes. Tag mode must not call embedding model.
- Admin mutations require existing admin access and origin dependencies.
- Do not commit.

---

## File Structure

- Create: `backend/app/tag_settings/parser.py` — pure content-to-canonical-tag parser/grouping.
- Create: `backend/app/tag_settings/store.py` — Qdrant indexing and approved settings persistence.
- Create: `backend/tests/unit/test_tag_parser.py` and `backend/tests/unit/test_tag_settings_store.py`.
- Modify: `backend/app/config.py`, `backend/app/main.py` — settings collection/store lifecycle.
- Modify: `backend/app/api/schemas/vector_search.py`, `backend/app/api/schemas/admin.py` — grouped tag DTOs and constrained request models.
- Modify: `backend/app/api/routes/vector_search.py`, `backend/app/api/routes/admin/sync.py` — picker, search, admin index/approval endpoints.
- Modify: `backend/app/integrations/qdrant_store.py`, `backend/app/file_embeddings/ingestion_service.py` — payload AND search and service dispatch.
- Modify: backend unit/integration tests associated with each API and adapter.
- Create: `frontend/src/components/AdminTagManagement.tsx` plus test.
- Modify: `frontend/src/types.ts`, `frontend/src/api/client.ts`, `frontend/src/components/AdminPage.tsx`, `frontend/src/components/SearchPanel.tsx` plus tests.

### Task 1: Add pure categorized content parser

**Files:**
- Create: `backend/app/tag_settings/__init__.py`
- Create: `backend/app/tag_settings/parser.py`
- Create: `backend/tests/unit/test_tag_parser.py`

**Interfaces:**
- Produces: `parse_content_tags(content: object) -> tuple[str, ...]`.
- Produces: `group_tags(tags: Iterable[str]) -> dict[str, list[str]]`.
- Consumes: untrusted asset payload `content`.

- [ ] **Step 1: Write failing parser tests**

```python
@pytest.mark.unit
def test_parse_content_tags_returns_canonical_category_values() -> None:
    content = """Subjects: laptop, keyboard, desk
Actions: displaying, connected
Setting: indoor, office
Colors: black, blue
Style: photo, real life
Visible text: account, Action
Angles: above, side"""

    assert parse_content_tags(content) == (
        "subject:laptop", "subject:keyboard", "subject:desk",
        "action:displaying", "action:connected", "setting:indoor",
        "setting:office", "color:black", "color:blue", "style:photo",
        "style:real life", "visible_text:account", "visible_text:action",
        "angle:above", "angle:side",
    )
```

Add tests for case-insensitive labels, outer whitespace, blank comma entries, duplicate canonical tag removal, unknown labels, non-string content, and same value in distinct categories returning distinct tags.

- [ ] **Step 2: Run parser test and verify failure**

Run: `uv run pytest backend/tests/unit/test_tag_parser.py -v`

Expected: FAIL because parser module absent.

- [ ] **Step 3: Implement parser without Qdrant dependency**

Define immutable mapping:

```python
CATEGORY_PREFIXES = {
    "subjects": "subject", "actions": "action", "setting": "setting",
    "colors": "color", "style": "style", "visible text": "visible_text",
    "angles": "angle",
}
```

Split only lines containing first colon. Casefold/trim label for lookup. Split remainder on commas; trim values; casefold canonical value; skip blanks. Build `f"{prefix}:{value.casefold()}"`; retain first occurrence order. `group_tags` splits once on colon, maps canonical prefix to display group label (`Subjects`, etc.), and sorts values case-insensitively.

- [ ] **Step 4: Verify parser and quality**

Run:

```bash
uv run pytest backend/tests/unit/test_tag_parser.py -v
uv run ruff format backend/app/tag_settings backend/tests/unit/test_tag_parser.py
uv run ruff check --select I --fix backend/app/tag_settings backend/tests/unit/test_tag_parser.py
uv run ruff check backend/app/tag_settings backend/tests/unit/test_tag_parser.py
```

Expected: PASS; no lint findings.

### Task 2: Index content tags and persist approvals in Qdrant

**Files:**
- Create: `backend/app/tag_settings/store.py`
- Create: `backend/tests/unit/test_tag_settings_store.py`
- Modify: `backend/app/config.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `TagIndexResult(indexed_assets: int, tags: tuple[str, ...])`.
- Produces: `TagSettingsStore.discover_and_index() -> TagIndexResult`.
- Produces: `TagSettingsStore.get_approved_tags() -> tuple[str, ...]`.
- Produces: `TagSettingsStore.replace_approved_tags(tags: list[str]) -> tuple[str, ...]`.

- [ ] **Step 1: Write failing indexing and settings tests**

Mock Qdrant scroll two pages. First page contains point ID `asset-1` with recognized content, second has `asset-2` with no recognized lines. Assert `set_payload` runs once per returned point:

```python
client.set_payload.assert_has_calls([
    call(collection_name="assets", payload={"tags": ["subject:laptop"]}, points=["asset-1"], wait=True),
    call(collection_name="assets", payload={"tags": []}, points=["asset-2"], wait=True),
])
```

Assert scroll asks only for `content`, uses `with_vectors=False`, passes returned next offset into next call, and result returns grouped/deduplicated canonical tags. Add test settings collection creation only if absent, missing record yields empty tuple, replacement upserts stable fixed ID and sanitized tags, and client failures chain safe `QdrantStorageError`.

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_tag_settings_store.py -v`

Expected: FAIL because store absent.

- [ ] **Step 3: Implement paginated index store**

`discover_and_index` loops Qdrant `scroll(collection_name=asset_collection, offset=offset, limit=1000, with_payload=["content"], with_vectors=False)`. Save returned next offset before updates. Parse each point content; call `set_payload(collection_name=asset_collection, payload={"tags": list(tags)}, points=[point.id], wait=True)`, including empty tags to clear stale tags. Accumulate canonical tags; stop only when next offset is `None`.

Separate settings collection uses existing vector size/cosine setup and fixed stable point ID. Approved tags save sanitized canonical list in payload. Do not update vectors or replace main asset payloads.

Add optional settings collection config defaulting to `<main collection>_tag_settings`; construct/start store in app lifespan; expose `application.state.tag_settings_store`; clear it at shutdown. Add injectable store argument to `create_app` for tests.

- [ ] **Step 4: Verify index store and lifecycle**

Run:

```bash
uv run pytest backend/tests/unit/test_tag_settings_store.py -v
uv run ruff format backend/app/tag_settings backend/app/config.py backend/app/main.py backend/tests/unit/test_tag_settings_store.py
uv run ruff check --select I --fix backend/app/tag_settings backend/app/config.py backend/app/main.py backend/tests/unit/test_tag_settings_store.py
uv run ruff check backend/app/tag_settings backend/app/config.py backend/app/main.py backend/tests/unit/test_tag_settings_store.py
```

Expected: PASS; no lint findings.

### Task 3: Add grouped picker, admin indexing, and approval endpoints

**Files:**
- Modify: `backend/app/api/schemas/vector_search.py`
- Modify: `backend/app/api/schemas/admin.py`
- Modify: `backend/app/api/routes/vector_search.py`
- Modify: `backend/app/api/routes/admin/sync.py`
- Modify: `backend/tests/integration/test_vector_search.py`
- Modify: `backend/tests/integration/test_admin_routes.py`

**Interfaces:**
- Produces: public `GET /v1/search/tags` grouped approved tags.
- Produces: protected `POST /admin/tags/discover` grouped tags plus indexed asset count.
- Produces: protected `GET /admin/tags` and `PUT /admin/tags`.

- [ ] **Step 1: Write failing endpoint tests**

Assert public picker returns `{ "groups": [{"category": "Subjects", "tags": ["subject:laptop"]}] }`. Assert anonymous admin calls get 401. Assert successful discover returns `indexed_assets` and discovered groups, invokes index operation, and does not invoke approval replace. Assert authorized save accepts only approved canonical tags from submitted discovery snapshot; missing/blank/out-of-snapshot tags receive 422.

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py -v`

Expected: FAIL because endpoints/schemas absent.

- [ ] **Step 3: Implement immutable schemas and routes**

Create frozen group response model `{category, tags}`. Public response wraps `groups`. Discovery response adds `indexed_assets`. Update request contains bounded `discovered_tags` and `approved_tags`; validator normalizes/deduplicates and requires approved subset of discovered.

Run all store calls via `asyncio.to_thread`. Public tags GET returns empty groups if setting record absent. Admin discovery POST uses existing access/origin deps; GET uses access; PUT uses access/origin. Map `QdrantStorageError` to existing safe 502 convention.

- [ ] **Step 4: Verify endpoint tests and lint**

Run:

```bash
uv run pytest backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py -v
uv run ruff format backend/app/api/schemas/vector_search.py backend/app/api/schemas/admin.py backend/app/api/routes/vector_search.py backend/app/api/routes/admin/sync.py backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py
uv run ruff check --select I --fix backend/app/api/schemas/vector_search.py backend/app/api/schemas/admin.py backend/app/api/routes/vector_search.py backend/app/api/routes/admin/sync.py backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py
uv run ruff check backend/app/api/schemas/vector_search.py backend/app/api/schemas/admin.py backend/app/api/routes/vector_search.py backend/app/api/routes/admin/sync.py backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py
```

Expected: PASS.

### Task 4: Add approved tag AND search backend

**Files:**
- Modify: `backend/app/api/schemas/vector_search.py`
- Modify: `backend/app/integrations/qdrant_store.py`
- Modify: `backend/app/file_embeddings/ingestion_service.py`
- Modify: `backend/app/api/routes/vector_search.py`
- Modify: `backend/tests/unit/test_qdrant_store.py`
- Modify: `backend/tests/unit/test_ingestion_service.py`
- Modify: `backend/tests/integration/test_vector_search.py`

**Interfaces:**
- Produces: `find_by_tags(tags, limit, provider=None) -> list[SearchHit]`.
- Produces: tag-mode `FileIngestionService.search(..., tags=...)`.

- [ ] **Step 1: Write failing backend search tests**

Assert `find_by_tags(["subject:laptop", "color:black"], ...)` uses separate Qdrant `Filter.must` tag conditions plus optional provider condition. Assert tag service call skips model embedding, maps full payloads, and drops incomplete payload. Assert endpoint rejects requested canonical tag not present in persisted approved tags with 422 and does not call asset store.

- [ ] **Step 2: Run tests to verify failure**

Run: `uv run pytest backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py -v`

Expected: FAIL because tag mode absent.

- [ ] **Step 3: Implement tag mode**

Extend request mode/validated tags. Prohibit tags for other modes; require nonempty tags for tag mode. Asset store imports `MatchAny`; adds `find_by_tags` with one `FieldCondition(key="tags", match=MatchAny(any=[tag]))` per tag in `Filter.must`, plus provider. Tag service branch invokes this method without embedding. Route checks requested tags subset of current approved tags then dispatches service.

- [ ] **Step 4: Verify backend search and lint**

Run:

```bash
uv run pytest backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py -v
uv run ruff format backend/app/api/schemas/vector_search.py backend/app/integrations/qdrant_store.py backend/app/file_embeddings/ingestion_service.py backend/app/api/routes/vector_search.py backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py
uv run ruff check --select I --fix backend/app/api/schemas/vector_search.py backend/app/integrations/qdrant_store.py backend/app/file_embeddings/ingestion_service.py backend/app/api/routes/vector_search.py backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py
uv run ruff check backend/app/api/schemas/vector_search.py backend/app/integrations/qdrant_store.py backend/app/file_embeddings/ingestion_service.py backend/app/api/routes/vector_search.py backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py
```

Expected: PASS.

### Task 5: Add grouped admin management and user picker UI

**Files:**
- Create: `frontend/src/components/AdminTagManagement.tsx`
- Create: `frontend/src/components/AdminTagManagement.test.tsx`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/components/AdminPage.tsx`
- Modify: `frontend/src/components/SearchPanel.tsx`
- Modify: `frontend/src/components/SearchPanel.test.tsx`

**Interfaces:**
- Produces: typed grouped public/admin API calls.
- Produces: admin Discover and index / explicit Save flow.
- Produces: tag filter grouped picker and newest-first results.

- [ ] **Step 1: Write failing frontend tests**

Admin test: click **Discover and index tags**, see groups and indexed count, verify no save request until **Save approved tags** click; selection changes are immutable and safe API errors render feedback.

SearchPanel test: mock public groups for Subjects and Colors; switch to tag filter, select `subject:laptop` and `color:black`, see human labels and removable chips; provider plus submit calls `searchVectors("", 100, "google_drive", "tag", ["subject:laptop", "color:black"])`; empty selection disables submit; results order by valid `modified_time` newest first and scores/sort selector remain absent.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm --prefix frontend test -- --run src/components/AdminTagManagement.test.tsx src/components/SearchPanel.test.tsx`

Expected: FAIL because components/API/types absent.

- [ ] **Step 3: Implement typed API and focused UIs**

Add grouped tag types/client APIs. Add focused `AdminTagManagement`, mount in AdminPage Settings, use existing toast/error patterns. Discovery must not mutate saved approval state until explicit save.

Add tag filter tab. Fetch public groups on opening. Render group headings plus buttons/checkboxes. No free-text tag field. Selected canonical tags render category/value chips. Clear selection when mode changes. Submit selected canonical tags with empty query/max limit. Sort tag results descending date; missing timestamps last. Keep old modes unchanged.

- [ ] **Step 4: Verify frontend**

Run:

```bash
npm --prefix frontend test -- --run src/components/AdminTagManagement.test.tsx src/components/SearchPanel.test.tsx src/components/AdminPage.test.tsx
npm --prefix frontend run lint
npm --prefix frontend run build
```

Expected: PASS.

### Task 6: Full verification

- [ ] **Step 1: Run focused backend suite**

Run:

```bash
uv run pytest backend/tests/unit/test_tag_parser.py backend/tests/unit/test_tag_settings_store.py backend/tests/unit/test_qdrant_store.py backend/tests/unit/test_ingestion_service.py backend/tests/integration/test_vector_search.py backend/tests/integration/test_admin_routes.py -v
```

Expected: PASS.

- [ ] **Step 2: Run frontend suite**

Run:

```bash
npm --prefix frontend test -- --run src/components/AdminTagManagement.test.tsx src/components/SearchPanel.test.tsx src/components/AdminPage.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Manual check**

Admin discovers/indexes content tags, approves grouped selection, saves, restarts backend, confirms approved groups persist. User sees only approved groups, selects tags across categories, gets assets matching every tag sorted newest first. Semantic and filename searches still work.

- [ ] **Step 4: Check working tree**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; no commit.
