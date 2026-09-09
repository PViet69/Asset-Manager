# Approved Tag Search Design

## Goal

Add tag-only asset search. Admin manually extracts categorized tags from existing asset description content, writes normalized tags to Qdrant asset payloads, approves tags for user picker, and persists approval. Users select approved tags; results contain assets matching every selected tag and appear newest first by `modified_time`.

## Scope

- Add `tag` to existing `POST /v1/search` modes.
- Extract tags from existing Qdrant asset payload `content`; current content follows labeled category-line format.
- On manual discovery, write derived `tags` string array back to each affected asset payload in main Qdrant collection.
- Admin selects approved discovered tags and persists selection.
- Users select only approved tags from grouped Tag Search picker.
- Persist approved tags in separate Qdrant settings collection. No SQL, Postgres, SQLite, external database, cache, scheduler, or background scan.
- Keep semantic and filename search behavior unchanged.
- Preserve optional provider filtering.

## Content Tag Format

Asset `content` contains lines using these labels:

- `Subjects`
- `Actions`
- `Setting`
- `Colors`
- `Style`
- `Visible text`
- `Angles`

Each label has comma-separated values. Parser treats labels case-insensitively, trims value whitespace, ignores empty values, and ignores unrecognized lines.

Derived Qdrant payload tags use canonical singular category prefixes plus normalized values:

- `subject:laptop`
- `action:connected`
- `setting:office`
- `color:black`
- `style:photo`
- `visible_text:account`
- `angle:above`

Category qualification prevents collisions between identical values in different categories. Value normalization trims outer whitespace and normalizes comparison case; stored/display value preserves readable text chosen by parser. Identical canonical tags deduplicate per asset.

## User Flow

### Admin tag management

1. Admin opens Tag Management in existing Admin dashboard.
2. Admin selects **Discover and index tags**.
3. Backend paginates every asset in main Qdrant collection with `content` payload only.
4. Backend parses categorized content, creates canonical payload tags, and updates every asset payload `tags` field. Assets with no recognized category lines receive empty tags array, removing stale derived tags.
5. Backend returns grouped unique discovered tags from indexed payload values.
6. Admin selects tags available to users, grouped by category.
7. Admin saves selection.
8. Backend writes selected approved tags as one durable settings record in separate Qdrant settings collection.
9. Later manual discovery/index runs update asset payload tags and show newly discovered tags. It does not alter saved approved selection until admin explicitly saves.

### User tag search

1. User opens Tag Search.
2. Frontend fetches currently approved tags from backend, organized by category.
3. User clicks one or more approved tags. Each selection appends removable filter chip.
4. User submits search.
5. Backend filters Qdrant asset payload `tags` by every selected tag, plus optional provider.
6. Frontend displays matches sorted by `modified_time`, newest first.

## API Contract

Existing `POST /v1/search` gains `tag` mode. Tag-mode requests carry selected canonical tags and optional provider filter; text query is ignored. Tags must contain at least one non-blank approved value. Validation normalizes values, bounds per-tag length and total selected-tag count, rejects malformed or unapproved tags with standard `422` responses, and removes repeated values before storage query.

Existing response shape (`VectorSearchResponse`) remains unchanged.

New endpoints support picker and management:

- Public read endpoint returns current approved tags grouped by category.
- Protected admin discovery/index endpoint scans main collection, writes derived asset payload tags, and returns discovered tags grouped by category without changing approved tags.
- Protected admin read endpoint returns saved approved tags grouped by category.
- Protected admin save endpoint replaces approved tags in settings collection using selections from discovery response.

Admin mutations use existing admin access and origin protections.

## Data Storage

### Main asset collection

Existing Qdrant asset collection remains source of truth for asset data and search results. Its existing `content` text is source of derived tags. Each discovery/index operation updates each point's `tags` payload field with derived canonical tag array. Existing `modified_time` remains sorting field.

### Tag settings collection

Separate Qdrant collection stores one durable settings record containing approved canonical tags. It has no semantic-search use; stored vector can be fixed minimal placeholder because only payload read/write operations are needed. Collection name derives from existing main collection name with deterministic settings suffix. Backend ensures collection during startup and creates it only when absent.

Read/save operations use stable record ID so save replaces prior approved selection atomically. Empty approved set is valid: public picker returns category groups with no values and Tag Search has no selectable tags.

## Backend Design

Add focused tag-management storage/service separate from asset `QdrantStore` search responsibility:

- Parse `content` category lines into canonical tag values.
- Paginate main Qdrant collection with payload projection limited to `content`.
- Update each point's `tags` payload through Qdrant payload update API without touching vector or other payload values.
- Return grouped, case-insensitively sorted discovered tags after indexing.
- Read and replace approved canonical tags in settings collection.
- Return immutable sanitized tag groups at API boundaries.

Index operation must make pagination safe while payload updates occur: retain next scroll offset before update, use point IDs from returned page, and do not delete or upsert main asset points.

Extend asset `QdrantStore` with tag search. Tag search uses Qdrant payload `must` conditions: one required `tags` condition per selected canonical tag. Since all conditions are required, every selected tag must match. Optional provider condition joins same requirement list. Query retrieves payloads only; tag search needs no embedding or semantic score. Return at most requested limit.

`FileIngestionService.search` routes `tag` mode to tag search after approved-tag validation. Results retain existing full-payload filtering and `VectorSearchItem` conversion. Existing route continues translating storage failures to safe `502` responses.

## Frontend Design

Add Tag Search third tab in `SearchPanel`.

Tag Search fetches and displays approved tags in category groups. Users cannot enter arbitrary tag text. Selected tags remain local panel state and appear as removable chips with human-readable category/value labels. Search enables only with at least one selected tag. Switching out of tag mode clears selected tags. Existing search endpoint client submits selected canonical tags, empty query, `tag` mode, top result limit, and selected provider.

Show tag-mode results in descending `modified_time` order. Semantic mode still shows relevance score. Filename mode retains user-selectable date sorting. Tag mode has no relevance score or sort selector.

Add Admin dashboard Tag Management section: Discover and index tags button, discovered grouped tag checkbox list, saved approved-tag state, Save approved tags button, loading/error/success states. Discovery/index does not overwrite saved selection until explicit save. Success feedback includes asset count indexed and unique tags discovered.

## Error Handling

- Empty, malformed, unknown-category, or unapproved selected tags fail API validation.
- Invalid/unrecognized content lines do not fail indexing; they produce no tag from that line.
- Discovery/index report safe Qdrant failure and must not partially claim success. UI shows error status.
- Public approved-tags read returns empty grouped result when no settings record exists.
- Settings read/write failures use safe Qdrant storage errors; admin UI shows existing dashboard error pattern.
- Tag search Qdrant errors use existing `QdrantStorageError` translation and expose only safe message.
- Frontend Tag Search and admin UI show existing error presentation for API failures.
- Missing/unparseable `modified_time` sorts after valid timestamps.

## Testing

- Parser unit tests cover recognized labels, case/whitespace normalization, multi-value lines, ignored labels, empty values, and category collision qualification.
- Indexing tests cover full Qdrant pagination, payload-only reads, per-point tags payload update, zero-tag asset update, returned grouped discovery list, and safe Qdrant failure.
- Settings store tests cover initialization, stable settings replacement, absent record, and grouped read sanitization.
- Admin integration tests cover authorization, discovery/index without approval persistence, indexed count, and explicit save replacement.
- Public picker endpoint tests cover saved grouped approved tags and empty state.
- Search schema/integration tests cover tag-mode validity, unapproved tags, and 422 failures.
- Asset Qdrant adapter tests assert one required condition per tag and combined provider condition.
- Service tests cover tag routing without embedding request, full-payload exclusion, provider propagation, and response mapping.
- Frontend API tests cover grouped picker, discovery/index, and save serialization.
- Search panel tests cover grouped approved tag selection, chips/removal, disabled state with zero tags, tag-mode request, provider propagation, and newest-first display.
- Admin dashboard tests cover discovery/index feedback, grouped selection, explicit save, and failure feedback.
