# React Aria UI redesign

Date: 2026-10-23
Status: Approved for implementation planning on 2026-10-23; implementation has not started.

## Intent

Replace the app's difficult-to-maintain custom UI with React Aria Components and a minimal, modern visual system. The user requested the whole app, explicitly including splitting CSS by module. They approved the revised visual direction after reviewing browser mockups.

The inspected frontend uses React 18, TypeScript, and Vite. Its global stylesheet was 4,941 lines at initial inspection, and both the search and admin components mix substantial interaction logic with presentation. This is a project-wide frontend migration, not a stylesheet-only cleanup.

## User decisions

- Migrate the whole app rather than one screen.
- Redesign the appearance with a minimal, modern look.
- Split CSS into modules.
- Reuse the existing Dropbox and Google Drive SVG logo assets from ProviderLogo.tsx.
- Use sidebar navigation without duplicate screen navigation across the top.
- Remove the sidebar organization/footer block.
- Combine provider and tag filtering into a single Filters button.
- Show the image/video files currently being indexed in administration.
- The revised mockup was accepted as the visual direction.

## Visual reference

The approved concept is saved at `references/2026-10-23-react-aria-ui-mockup.html` beside this document. It is a standalone prototype containing sample data, not production code or an exact inventory of existing features. Runtime server state and session keys must not be committed.

Use white surfaces over a light neutral canvas, dark slate text, muted secondary text, one restrained blue accent, subtle borders, modest radii, and minimal shadows. Use a native system sans-serif stack, clear hierarchy, generous page spacing, and compact controls. Asset previews provide most of the color. Remove decorative glass surfaces, gradients, animated coverage gauges, and the animated login backdrop from the new UI.

Starting tokens, chosen by the designer: canvas #f7f8fa, surface #ffffff, text #202731, secondary text #626e7c, border #e4e8ed, action #345cce, selection #edf2ff. Validate actual foreground/background combinations and interactive states before shipping; tune tokens if needed.

## Scope and behavior

### Shared shell and navigation

Use one shared app shell with an Asset Manager brand and navigation to asset search and administration. Preserve current public search access and authenticated admin access. Keep `/` and `/admin` routing and existing handling of `/admin/*`; no router replacement is required. Keep the admin bundle lazy-loaded.

Within authenticated administration, use one local navigation set for Overview, Providers, Models, Activity, and Settings/Tags. These correspond to current admin sections and retain access to their existing capabilities; labels and exact grouping are implementation decisions. The prototype's Overview/Tags tabs were illustrative and do not authorize dropping other existing sections. Do not duplicate identical destinations in a top bar and sidebar.

Use a compact, accessible mobile navigation at narrow widths; the specific breakpoint and drawer versus stacked navigation are left to implementation. Login belongs to the existing administration entry flow, not an extra permanent production navigation item alongside an authenticated Sign out action. The prototype's sign-in shortcut is a preview convenience.

### Search

Preserve description/semantic search, filename search, result limits and validation, existing filename debounce, stale-response protection, provider filters, approved tag groups, filename date sorting, thumbnails, result metadata, and existing result links/actions. Preserve loading, empty, error, and model-unavailable behavior. Keep sorting meaningful for the selected search mode.

Use React Aria tabs for the two search modes and a clearly labeled search field with submit and clear actions. The single Filters button opens a dialog containing provider selection and grouped multi-select tags. Retain draft selections: Apply commits filters and triggers the same searches as today; Cancel, Escape, or dismiss discards uncommitted changes. Show applied selection counts or a concise summary and allow clearing filters. Do not leave separate provider and tag trigger buttons beside it or a second Filters trigger elsewhere.

Display results in a responsive asset grid with restrained thumbnail framing, filename, provider, and available date/type metadata. Preserve non-image file fallbacks. Keep filenames and result links keyboard accessible. Do not create new file types, synthetic metadata, or representative images in production results.

### Administration

Restyle and preserve provider enabled/health state, detected and indexed counts, refresh, synchronization, current stop/cancellation semantics where supported by the existing client, provider item browsing, reindex actions, deletion confirmation, model health, session handling, tag discovery and approval, and existing status/error feedback. Inventory actual current handlers and tests during planning; mockup omissions do not remove working functionality.

Replace decorative charts/gauges with clear detected/indexed/pending totals and provider rows; retain the ability to inspect provider-specific counts. Show embedding and description model health separately rather than hiding either behind one overall Available label. Null or unavailable counts stay unknown, not a confident zero. Coverage calculations must handle empty providers and invalid totals.

Tag management keeps category grouping, expansion, selected counts, discovery, clear selection, saved approved tags, and saving feedback. Provider item dialogs retain item identity and existing reindex/delete actions. Destructive actions require explicit confirmation with the affected file identified.

### Indexing visibility

Show an Indexing now section on the overview and provider workspace, using the existing sync activity transport and statuses: preparing, indexing, indexed, failed, stopped. Show all active files reported by the server, with provider logo/name, filename, media type when known, and explicit status. Do not invent concurrent files, frame progress, percentages, file paths, or completion times.

The current SyncActivityEvent type includes provider, sequence, filename, status, and detail; it does not include a stable file ID, thumbnail URL, file path, or MIME type. This design keeps backend contracts unchanged. Show a file/media icon when metadata is unavailable; a filename extension can inform an image/video icon, but must not determine identity. Show a real thumbnail only if existing data can identify the exact file unambiguously. Never match solely on filename, use another file's thumbnail, or block status updates waiting for a preview. Unknown names display a provider-level Preparing status rather than a fictional filename.

This fallback policy is a designer decision: the required outcome is identifying which files are active, and thumbnails are best effort under existing contracts. If guaranteed previews for newly discovered files are later required, that is a separate backend enrichment decision. Do not add raw trace/detail rendering or expose additional backend metadata as part of this migration.

Reconcile status updates using identities and ordering actually supported by the current transport, keeping separate providers separate. Completed/failed/stopped entries move to a bounded recent activity list with readable text. Show a distinct idle state when no files are active. Preserve the current connection/session lifecycle and cleanup; a disconnected stream must not silently present stale work as live. Do not add cross-session history persistence or a new job service.

Stop sync acts on the provider job, never on an individual media file. Render it once per active provider only if the current backend/client supports cancellation; the repeated per-file prototype buttons are illustrative and must not imply per-file cancellation. Preserve whichever existing stop behavior is actually available rather than adding a new cancellation API.

### Authentication and dialogs

Replace the decorative login scene with a focused username/password form. Retain existing cookies/session/API behavior, validation, unauthorized transitions, and sign-out. Do not persist credentials differently.

Use React Aria modal/dialog primitives for filters, item browsing, errors, deletion confirmations, and mobile drawers where applicable. Require meaningful labels, appropriate dialog/alertdialog semantics, focus containment and restoration, Escape behavior, scroll containment, and keyboard operation. Destructive confirmation dismissal cancels the operation.

## Component and styling architecture

Use the `react-aria-components` package instead of implementing low-level interaction hooks manually. It supplies behavior and accessibility, not a theme. Style the components locally with CSS Modules and shared tokens.

Proposed boundaries, chosen by the designer and adjustable to match repository conventions:

```text
frontend/src/
  styles/
    tokens.css
    global.css
  components/
    ui/                 # Button, field, select, dialog, tabs, checkbox, etc.
      Button.tsx
      Button.module.css
      ...
    layout/             # shell and responsive navigation
      ...
  features/
    search/             # search workspace, filters, grid, result card, hook
    admin/              # overview, providers/items, models, activity, tags
    auth/               # login and session-facing UI
```

Each component or cohesive feature owns its `.module.css`; reuse shared controls without copying selectors across screens. Only reset/base element styles, font defaults, and shared tokens are global. Delete the old monolithic styles.css once all consumers are migrated; do not just rename it or split it into arbitrarily sized files. Avoid a new giant feature stylesheet and cross-feature selector overrides. Use React Aria state attributes for hover, pressed, disabled, invalid, selected, and focus-visible states.

Keep wrappers thin and typed. Create shared abstractions only for actual repeated needs; do not build a separate general-purpose component framework. Use ordinary semantic HTML for layout and static content rather than wrapping everything in a library component. Native links remain appropriate for navigation. Preserve existing provider logo components and thumbnail fetching/cache behavior.

Extract meaningful search/admin state coordination into focused hooks or controllers so large screens compose sections rather than embedding every request, effect, dialog, and row. Keep API modules and domain types separate from UI primitives. Preserve backend behavior and search/indexing semantics.

## Constraints and non-goals

- Retain React, TypeScript, Vite, the current API, and current authentication model.
- No Tailwind, second component library, CSS-in-JS runtime, routing overhaul, or state-management framework is needed.
- No backend schema/pipeline rewrite, new job persistence, search algorithm changes, or data migration.
- No new dark theme or user theme settings in this scope.
- Mockup content and preview controls never become production data or features.
- A 3D login background is intentionally replaced by the minimal login design. Remove its assets/dependency only if nothing else uses them.
- Behavior preservation includes working features omitted from the prototype; decorative effects may be removed.

## Acceptance and validation

1. All current production screens use the accepted minimal visual system and shared controls.
2. Custom dropdown/tab/modal interaction logic is replaced by React Aria where appropriate, with keyboard, focus, dismissal, and screen-reader behavior verified.
3. Global styles contain only base styles/tokens; each feature/component owns scoped styles and the old monolithic stylesheet is removed.
4. One combined filter entry preserves draft/apply/cancel and grouped tag/provider semantics.
5. Existing logos appear consistently. Duplicate top navigation and organization footer are absent.
6. Active image/video filenames and provider/status are visible during real sync; unavailable thumbnails use honest fallbacks. Terminal and idle states update correctly.
7. Existing search, admin, session, provider item, reindex/delete, model health, and tag workflows continue to work.
8. Focused tests cover meaningful preserved behavior, new filter interactions, navigation, dialogs, and sync activity transitions; adjust existing tests to accessible behavior rather than old CSS classes.
9. Run frontend tests, typecheck, and production build. Use browser checks on desktop, narrow laptop, and mobile widths, including long filenames, empty/error/loading states, active indexing, focus restoration, and reduced motion. No page-wide horizontal overflow; intentionally scrollable item tables remain usable.

## Planning clarifications

Current source inspection confirms `streamAdminSync(provider, onEvent, signal)` and `stopAdminSync(provider)` in `frontend/src/api/client.ts`. Keep this streamed transport and provider-level stop endpoint. Do not implement the obsolete WebSocket/job-ID approach described in older project documents. Reindex exists as an API helper but is not currently exposed by the inspected provider item UI; preserve the API helper without adding a new reindex flow solely because of this redesign.

## Delivery boundaries

After approval of this document, create an implementation plan with dependency-ordered migration steps and verification. The app may be migrated internally in slices, but completion covers the whole agreed app; do not stop after one screen. Do not begin product implementation or install dependencies before approval. Exact component filenames, hook decomposition, responsive breakpoints, test arrangement, and the smallest practical React Aria primitive set are left to the builder within this design.
