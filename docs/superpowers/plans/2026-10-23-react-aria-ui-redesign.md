# React Aria UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the whole Asset Manager frontend around React Aria Components and scoped CSS Modules while retaining current search, authentication, administration, and sync behavior.

**Architecture:** Keep the existing React/Vite app, API client, routes, and lazy admin entry. Introduce thin styled React Aria primitives, extract feature state from the large search/admin screens, and migrate each feature to its own CSS Modules. Consume the existing streamed sync events without adding backend metadata or cancellation contracts.

**Tech Stack:** React 18, TypeScript, Vite, react-aria-components, CSS Modules, Vitest, Testing Library, npm/package-lock.json.

**Spec:** `docs/superpowers/specs/2026-10-23-react-aria-ui-redesign-design.md` (read alongside this plan).

## Global Constraints

- Retain React, TypeScript, Vite, the current API, and current authentication model.
- No Tailwind, second component library, CSS-in-JS runtime, routing overhaul, or state-management framework is needed.
- No backend schema/pipeline rewrite, new job persistence, search algorithm changes, or data migration.
- No new dark theme or user theme settings in this scope.
- Mockup content and preview controls never become production data or features.
- Reuse the existing Dropbox and Google Drive SVG logo assets from ProviderLogo.tsx.
- Global styles contain only base styles/tokens; each feature/component owns scoped styles and the old monolithic stylesheet is removed.
- One combined filter entry preserves draft/apply/cancel and grouped tag/provider semantics.
- Stop sync acts on the provider job, never on an individual media file.
- Retain `/`, `/admin`, `/admin/*`, lazy admin loading, cookie credentials, and existing unauthorized transitions.
- Start with canvas #f7f8fa, surface #ffffff, text #202731, secondary #626e7c, border #e4e8ed, action #345cce, selection #edf2ff. Validate contrast and focus states.
- Do not push this work: the user requested local amendments and a plan, not remote publication.

## Review Focus

- Switching modes or filters while requests are pending must prevent old responses replacing current results (Task 3).
- Escape inside a select popover or nested confirmation must close the top overlay first and restore focus correctly (Tasks 1, 4, 9).
- Session expiration during an active stream must abort that stream and prevent late events repopulating protected UI (Tasks 2, 6, 8).
- Same filenames across providers, repeated event sequences, and missing file identity must not create false previews or completion counts (Task 8).
- Long names, missing timestamps/counts, and small viewports must preserve readable content without page-wide horizontal scrolling (Tasks 5, 7, 10).

## Source baseline and execution rules

The relevant current source was inspected through codebase-memory and direct reads of identified files. `SearchPanel.tsx` owns mode/query/filter/result state. `AdminPage.tsx` owns session, status, items, tags, and streams. `streamAdminSync(provider, onEvent, signal): Promise<void>` delivers `SyncEvent` from `api/client.ts`; `stopAdminSync(provider)` stops a provider. The current activity type has no stable storage ID or thumbnail URL. `SearchResultThumbnail` already handles authenticated blob fetching, visibility, and object URL cleanup.

Use codebase-memory first for subsequent discovery. Re-read any file that changed after this plan. Do not restore old WebSocket/job-ID designs from historical plans. `reindexAdminStorageFile` currently exists as an API helper but has no rendered action in the inspected item list; leave that helper intact, without adding an unrelated workflow.

Before Task 1, run `npm --prefix frontend test -- --run`, `npm --prefix frontend run typecheck`, and `npm --prefix frontend run build`; record baseline failures separately. Check `git status` and preserve unrelated changes. Follow the repository's br workflow if a project-local database is available; this checkout has no `.beads/`, and the discovered parent database requires access outside the workspace. Do not initialize a replacement tracker or modify another project's database.

All test commands below run from the repository root. Test files import `@testing-library/jest-dom/vitest`, use `userEvent` for interaction, and clean up after each test. Existing tests must move with their subjects or update imports/mocks in the same commit. Keep API client tests unchanged unless fixing an actual import issue. Do not replace behavioral tests with class-name assertions.

## File ownership

```text
frontend/src/styles/{tokens,global}.css        base/reset and shared design tokens
frontend/src/components/ui/                   shared interactive primitives
  Button.tsx / Button.module.css
  Dialog.tsx / Dialog.module.css
  Fields.tsx / Fields.module.css
  Tabs.tsx / Tabs.module.css
frontend/src/components/layout/
  AppShell.tsx / AppShell.module.css           brand, links, mobile navigation
frontend/src/features/search/
  useAssetSearch.ts, search.types.ts          query, requests, filtering, sorting
  SearchWorkspace.tsx / .module.css           search composition and mode panels
  SearchFiltersDialog.tsx / .module.css       draft provider/tag selection
  SearchResults.tsx / .module.css             result states and grid
  SearchResultCard.tsx / .module.css          filename, preview, metadata, links
frontend/src/features/auth/
  useAdminSession.ts                         session and login/logout lifecycle
  AdminLoginForm.tsx / .module.css            minimal credentials form
frontend/src/features/admin/
  AdminWorkspace.tsx / .module.css            local section composition
  useAdminDashboard.ts                        counts, provider refresh, feedback
  useProviderItems.ts                         browsing and deletion state
  useApprovedTags.ts                          discovery, draft approval, save
  useProviderSync.ts                          stream ownership, stop, cleanup
  syncActivity.ts                             pure event reconciliation
  admin.types.ts                             local shared view-model types
  AdminOverview.tsx / .module.css             totals and provider inspection
  AdminProviders.tsx / .module.css            provider list and actions
  ProviderItemsDialog.tsx / .module.css        browsing and deletion confirmation
  ApprovedTagsPanel.tsx / .module.css          category selection and saving
  SyncActivityPanel.tsx / .module.css          active files and bounded history
```

Retain `components/ProviderLogo.tsx`, `SearchResultThumbnail.tsx`, `AdminModelHealth.tsx`, and `ModelUnavailableDialog.tsx`, giving the latter three adjacent `.module.css` files. `App.tsx` remains the route switch. During migration retain `components/SearchPanel.tsx` and `AdminPage.tsx` as thin adapters to preserve imports/tests; remove obsolete adapters only in Task 10. Avoid barrel exports that eagerly load admin code into the public bundle. No separate Card/Badge/Status abstraction is required for simple markup.

## Task 1: Styled React Aria controls with reliable overlay behavior

**Files:** Create the four `components/ui` TSX/CSS pairs above, `components/ui/controls.test.tsx`, `styles/tokens.css`, `styles/global.css`, and `test/setup.ts`. Modify `frontend/package.json`, `frontend/package-lock.json`, and `frontend/vite.config.ts`.

**Interfaces:**
- `Button(props: ButtonProps & { variant?: 'primary' | 'secondary' | 'danger' | 'quiet' }): JSX.Element`, where ButtonProps is React Aria's type; default type is button.
- `Dialog(props: { isOpen: boolean; onOpenChange(open: boolean): void; title: string; role?: 'dialog' | 'alertdialog'; isDismissable?: boolean; isKeyboardDismissDisabled?: boolean; children: ReactNode }): JSX.Element`; children remain ordinary content/actions, with a Heading slot for title.
- `TextField(props: TextFieldProps & { label: string; type?: 'text' | 'password'; autoComplete?: string }): JSX.Element`.
- `SelectField(props: { label: string; value: string; options: readonly { id: string; label: string }[]; onChange(value: string): void; isDisabled?: boolean }): JSX.Element`.
- `CheckboxField` uses React Aria CheckboxProps plus `children: ReactNode`. Styled `Tabs`, `TabList`, `Tab`, `TabPanel` preserve the underlying React Aria prop types.

- [ ] Install only `react-aria-components` with npm in `frontend`, checking the selected release's React 18 peer support; preserve the lockfile. Consult official package docs rather than copying website example-wrapper APIs as library APIs.
- [ ] Write tests `disabled button never invokes onPress`, `dialog traps Tab and restores trigger focus after Escape`, `nested select Escape leaves parent dialog open`, and `arrow keys select matching tab panel`. Assert accessible names, focus, callbacks, and selected panel, not implementation selectors.
- [ ] Run `npm --prefix frontend test -- --run src/components/ui/controls.test.tsx`; expect new control imports/assertions to fail before implementation.
- [ ] Implement the controls with React Aria Button, ModalOverlay/Modal/Dialog/Heading, TextField/Input/Label, Select/Popover/ListBox, Checkbox, and Tabs primitives. Honor native form submission explicitly via `type="submit"`. Add only required jsdom browser shims to `test/setup.ts` via Vitest setupFiles; use real library behavior, not mocked controls.
- [ ] Define tokens, base typography, box sizing, and reduced-motion styles. Add module-local state selectors and portal overlay styling without depending on ancestor screen selectors. Do not import the new global sheet into production until shell migration in Task 2; do not override every old class.
- [ ] Rerun focused tests and typecheck; both must pass. Commit as `feat: add styled React Aria controls` with only Task 1 paths staged.

## Task 2: Shared shell and minimal authenticated entry

**Files:** Create `components/layout/AppShell.tsx`, `.module.css`, `.test.tsx`; `features/auth/useAdminSession.ts`, `AdminLoginForm.tsx`, `.module.css`, `.test.tsx`. Modify `App.tsx`, `App.test.tsx`, `main.tsx`, `components/AdminPage.tsx`, and its tests.

**Interfaces:**
- `AppShell({ activeArea, children }: { activeArea: 'search' | 'admin'; children: ReactNode }): JSX.Element`; native links target `/` and `/admin`, with aria-current and one responsive navigation instance.
- `useAdminSession(): { status: 'checking' | 'authenticated' | 'anonymous'; error: string | null; isSubmitting: boolean; login(username: string, password: string): Promise<void>; logout(): Promise<void>; expire(): void; clearError(): void }`.
- `AdminLoginForm({ session }: { session: ReturnType<typeof useAdminSession> }): JSX.Element`.

- [ ] Add tests `public search does not request admin session`, `admin entry checks session before protected content`, `401 shows login`, `login navigates to /admin/dashboard`, `429 retains existing actionable error`, and `logout clears local state even if remote logout fails`. Assert credentials are passed only to loginAdmin and never stored in localStorage. Add shell test `mobile navigation closes on selection and returns focus`.
- [ ] Run `npm --prefix frontend test -- --run src/App.test.tsx src/components/layout/AppShell.test.tsx src/features/auth/AdminLoginForm.test.tsx src/components/AdminPage.test.tsx`; expect new assertions to fail.
- [ ] Implement the shared shell and session hook using existing loginAdmin/getAdminSession/logoutAdmin. Prevent transient protected rendering before session verification. Keep cookie handling in the API client. Use shared Dialog if navigation is a drawer. Remove duplicated top navigation and organization/footer content; remove login-background rendering.
- [ ] Import tokens/global before the temporary legacy stylesheet. Keep old screen-specific CSS during migration, trimming only conflicting root/body defaults. AppShell owns page sizing and only one main landmark. Keep admin's lazy import boundary.
- [ ] Run the focused tests and typecheck; commit as `feat: redesign app shell and admin sign in`.

## Task 3: Isolate search state without changing request semantics

**Files:** Create `features/search/search.types.ts`, `useAssetSearch.ts`, `useAssetSearch.test.tsx`. Modify `components/SearchPanel.tsx` to consume the hook; preserve its current markup until Tasks 4–5.

**Interfaces:** Export `SearchMode = 'semantic' | 'filename'`, `SortOrder = 'relevance' | 'date_desc' | 'date_asc'`, `SearchFilters = { provider: string; tags: readonly string[] }`, and the existing SearchState discriminated union. `useAssetSearch({ externalTopK }: { externalTopK?: string } = {})` returns `{ query, setQuery, mode, setMode, filters, applyFilters, providers, tagGroups, sort, setSort, state, sortedItems, submit }`; setters use those types, `submit(): Promise<void>`, `applyFilters(filters: SearchFilters): void`.

- [ ] Add tests `semantic submit clamps 1–100 with default 10`, `filename waits 150ms and requests limit 100`, `4191 characters never submits`, `mode switch discards pending response`, `filter change discards pending response`, and `semantic preserves relevance order`. Mock deferred API responses and assert only current data is rendered. Preserve existing invalid/missing-date sort ordering with explicit fixtures.
- [ ] Run `npm --prefix frontend test -- --run src/features/search/useAssetSearch.test.tsx src/components/SearchPanel.test.tsx`; new tests must first fail.
- [ ] Move query/request/filter/sort logic into the hook; keep MAX_QUERY_LENGTH=4190, 150ms filename debounce, existing empty-query behavior, and safe request invalidation. Keep draft filter state out of this hook. Do not add a fetching library or duplicate API calls.
- [ ] Rerun both suites and typecheck, preserving all existing search API argument assertions. Commit as `refactor: isolate asset search state`.

## Task 4: One provider-and-tags filter dialog

**Files:** Create `features/search/SearchFiltersDialog.tsx`, `.module.css`, `.test.tsx`; modify `components/SearchPanel.tsx` and `SearchPanel.test.tsx`.

**Interfaces:** `SearchFiltersDialog({ value, providers, groups, onApply }: { value: SearchFilters; providers: readonly ProviderMeta[]; groups: readonly TagGroup[]; onApply(value: SearchFilters): void }): JSX.Element`. This component owns the single Filters trigger, applied-summary display, open state, and temporary draft; consumers do not render another trigger.

- [ ] Write `Cancel and Escape discard draft provider and tags`, `Apply commits both exactly once`, `clear filters uses empty provider and tags`, `reopen initializes from applied filters`, and `Escape closes provider select before filter dialog`. Assert one Filters button and no separate provider/tag triggers. Use actual Checkbox/Select keyboard interactions.
- [ ] Run `npm --prefix frontend test -- --run src/features/search/SearchFiltersDialog.test.tsx`; expect failure.
- [ ] Compose Dialog, SelectField, CheckboxField, labeled groups, Apply, Cancel, and Clear. An All providers option maps to empty provider. Retain full namespaced tag values while presenting display labels. Opening/dismissing never searches; applying delegates to the search hook once. Summary counts only applied values.
- [ ] Replace old filter markup, portal code, click-outside listeners, and corresponding local state in SearchPanel. Update tests to the new accessible controls.
- [ ] Run new and existing search tests and typecheck; commit as `feat: unify provider and tag filtering`.

## Task 5: Minimal search workspace and result grid

**Files:** Create `SearchWorkspace.tsx`, `SearchResults.tsx`, `SearchResultCard.tsx` under `features/search`, each with `.module.css`; create `SearchResults.test.tsx`. Modify `components/SearchPanel.tsx`, `SearchPanel.test.tsx`, `SearchResultThumbnail.tsx`, its tests, and create `SearchResultThumbnail.module.css`. Modify `ModelUnavailableDialog.tsx` and create its `.module.css` and `.test.tsx`.

**Interfaces:** `SearchWorkspace(props: SearchPanelProps): JSX.Element` composes Tasks 3–4; `SearchResults({ state, items }: { state: SearchState; items: readonly VectorSearchItem[] }): JSX.Element`; `SearchResultCard({ item }: { item: VectorSearchItem }): JSX.Element`. Keep SearchResultThumbnail's existing `{ thumbnailUrl, filename }` props. ModelUnavailableDialog retains `onDismiss(): void`.

- [ ] Add `long filename and source link remain accessible`, `missing date/provider/thumbnail renders truthful fallback`, `loading empty and error states are distinct`, and `model-unavailable dialog restores focus on dismissal`. Retain score display, snippets, source actions, and current error-dismiss behavior proven by existing tests.
- [ ] Run `npm --prefix frontend test -- --run src/features/search/SearchResults.test.tsx src/components/SearchPanel.test.tsx src/components/SearchResultThumbnail.test.tsx src/components/ModelUnavailableDialog.test.tsx`; expect the new behavior/structure assertions to fail initially.
- [ ] Build the white/light-gray workspace, React Aria search mode panels, SearchField input, sort select, result grid, and cards. Keep the query/filter controller above mode panels so tab mounting does not reset searches. Use the existing thumbnail component and original provider logos. Show no mocked previews or invented dates. Use a generic icon if preview is unavailable; preserve blob validation, lazy visibility, and cleanup.
- [ ] Replace the error popup with shared Dialog using appropriate alertdialog semantics; move all feature-specific styles into modules. The SearchPanel adapter now only renders SearchWorkspace.
- [ ] Run focused suites, typecheck, and build. Inspect at 390, 937, and 1440px widths, checking long-name overflow and action visibility. Commit as `feat: redesign asset search workspace`.

## Task 6: Extract admin state and stream ownership

**Files:** Create `features/admin/admin.types.ts`, `useAdminDashboard.ts`, `useProviderItems.ts`, `useApprovedTags.ts`, `useProviderSync.ts`, and `useAdminControllers.test.tsx`. Modify `components/AdminPage.tsx` and tests; existing presentation stays until subsequent tasks.

**Interfaces:**
- Move `DashboardState`, `Toast`, and `PendingDeletion` shapes from AdminPage to admin.types. Keep existing domain API types in `types.ts` unchanged.
- `useAdminDashboard({ enabled, onUnauthorized }: { enabled: boolean; onUnauthorized(): void })` returns `{ dashboard, isLoading, refreshingProviders, error, reload, refreshProvider, updateProvider, notify, toasts }`; `reload(): Promise<void>`, `refreshProvider(id: string): Promise<void>`, `updateProvider(status: ProviderDashboardStatus): void`, `notify(message: string, type: 'status' | 'error'): void`.
- All remaining hooks consume a common `onError(error: unknown, fallback: string): void` and `enabled: boolean`.
- `useProviderItems(options)` returns `{ itemsByProvider, openProvider, loadingProviders, pendingDeletion, deletingProviders, open(id: string): Promise<void>, close(): void, requestDelete(provider: string, item: QdrantItem): void, cancelDelete(): void, confirmDelete(): Promise<void> }`; options add `onDeleted(provider: string): void`.
- `useApprovedTags(options)` returns `{ groups, selected, expandedCategories, isLoading, isDiscovering, isSaving, discover(): Promise<void>, toggle(tag: string): void, toggleCategory(category: string): void, clear(): void, save(): Promise<void> }`.
- `useProviderSync(options)` returns `{ activityByProvider, syncingProviders, stoppingProviders, connectionByProvider, start(id: string): Promise<void>, stop(id: string): Promise<void> }`; options add `onComplete(provider: string): Promise<void>` and `onModelUnavailable(): void`. The activity/connection types are finalized in Task 8; initially preserve current event arrays and transport behavior.

- [ ] Add `401 clears protected state and aborts active stream`, `late provider items response after logout is ignored`, `delete failure retains item and error`, `tag discovery preserves approved selection`, and `unmount aborts streams`. Assert API calls, abort signals, and visible state with deferred requests.
- [ ] Run `npm --prefix frontend test -- --run src/features/admin/useAdminControllers.test.tsx src/components/AdminPage.test.tsx`; expect new lifecycle assertions to fail.
- [ ] Move existing behavior into hooks, preserving error copy and API methods. Invalidate asynchronous work on disabled/session change and unmount. Do not treat aborted client requests as successful server stops. Use authoritative status refresh after sync completion/deletion rather than expanding approximate filename-based counts.
- [ ] Make AdminPage compose session/controller hooks and existing render sections, removing duplicated state/effects only after tests prove the extraction. Keep authorized-only hooks disabled while checking/anonymous.
- [ ] Run controller/admin tests and typecheck; commit as `refactor: split admin feature controllers`.

## Task 7: Minimal admin overview, providers, and models

**Files:** Create `features/admin/AdminWorkspace.tsx`, `AdminOverview.tsx`, `AdminProviders.tsx` and their `.module.css`; create `AdminOverview.test.tsx`. Modify `components/AdminPage.tsx`, `AdminNavigation.tsx`, `AdminNavigation.test.tsx`, `AdminProviderCard.tsx`, `AdminProviderCard.test.tsx`, `AdminModelHealth.tsx`, `AdminModelHealth.test.tsx`; create adjacent modules for retained components. Remove AdminProviderCard when its behavior is fully owned by AdminProviders, updating imports/tests in the same commit.

**Interfaces:** `AdminWorkspace(): JSX.Element` composes hooks from Task 6; AdminPage becomes a lazy-entry adapter. `AdminOverview({ dashboard, isLoading }: { dashboard: DashboardState; isLoading: boolean }): JSX.Element`; `AdminProviders({ dashboard, controls }: { dashboard: DashboardState; controls: { refreshingProviders: ReadonlySet<string>; syncingProviders: ReadonlySet<string>; stoppingProviders: ReadonlySet<string>; onRefresh(id: string): void; onBrowse(id: string): void; onStart(id: string): void; onStop(id: string): void } }): JSX.Element`.

- [ ] Test `null counts show unavailable not zero`, `empty provider list has useful empty state`, `embedding and description health remain separate`, `disabled provider cannot start sync`, `provider row exposes browse refresh and provider-level stop`, and `all five admin destinations remain reachable`. Preserve provider-specific count inspection using row values rather than the old chart filter.
- [ ] Run overview, navigation, provider, model, and AdminPage suites; verify new assertions fail before replacing markup.
- [ ] Render flat totals and provider rows; represent partial/unknown totals honestly, clamp pending to nonnegative values, and avoid a fabricated percentage when the denominator is zero or unknown. Retain provider identity and logos; use shared Button states and explicit Loading/Refreshing/Stopping copy. No file-level stop button.
- [ ] Replace decorative bar/gauge layouts and local nav markup with accessible React Aria section tabs (Overview, Providers, Models, Activity, Settings) and associated panels. Keep shared area links in AppShell; tabs switch sections rather than repeating those links. Restyle both model panels using CSS Modules.
- [ ] Run focused tests, typecheck, and browser inspection for desktop/mobile rows, null metrics, and two different model health states. Commit as `feat: redesign admin overview and providers`.

## Task 8: Truthful active indexing and bounded recent activity

**Files:** Create `features/admin/syncActivity.ts`, `.test.ts`, `SyncActivityPanel.tsx`, `.module.css`, `.test.tsx`; modify `useProviderSync.ts`, `AdminWorkspace.tsx`, `useAdminControllers.test.tsx`. Replace `components/AdminSyncActivityPanel.tsx` and its tests with the feature component once imports are migrated.

**Interfaces:** `ProviderActivityState = { lastSequence: number; active: readonly SyncActivityEvent[]; recent: readonly SyncActivityEvent[]; connection: 'idle' | 'streaming' | 'finished' | 'interrupted' | 'stopped' }`; `reduceSyncEvent(current: ProviderActivityState, event: SyncEvent): ProviderActivityState`. `SyncActivityPanel({ providers, activity }: { providers: readonly ProviderDashboardStatus[]; activity: Readonly<Record<string, ProviderActivityState>> }): JSX.Element`. Hook callers use `activity` in place of raw event arrays after this task; update all consumers together.

- [ ] Write reducer fixtures for ordered preparing/indexing/indexed transitions, duplicate/out-of-order sequence rejection, independent provider states for identical filenames, null filenames, and terminal events. Assert `recent.length <= 50` per provider, no active entries after terminal completion, and no raw event detail rendering. Sequences reset only when starting a new provider stream.
- [ ] Add panel/controller tests `active image and video filenames visible on Overview and Providers`, `filename-only events never fetch another asset thumbnail`, `interrupted connection is labeled and no longer active`, `successful provider stop clears live state`, and `stop failure does not report stopped`. Assert logout aborts and ignores late events from a replaced controller.
- [ ] Run `npm --prefix frontend test -- --run src/features/admin/syncActivity.test.ts src/features/admin/SyncActivityPanel.test.tsx src/features/admin/useAdminControllers.test.tsx`; new reducer/panel cases must fail before implementation.
- [ ] Implement sequence-based event identity within each provider stream. The existing transport uses filenames as update correlation but cannot distinguish duplicate basenames within one provider: render reported names/statuses without claiming unique storage identity; use sequence for React keys and retain provider separation. Never synthesize storage IDs or infer a thumbnail URL. When correlating successive same-name statuses, label only the latest reported status and do not infer exact unique-file totals from it.
- [ ] Display active names, real provider logos, image/video icons inferred from extension when available, explicit Preparing/Indexing text, and idle/interrupted states. Under current contracts use icons rather than lookup-by-filename previews. Keep terminal events in bounded recent history and clear active indicators on stream end/error. Place the panel on Overview and Providers; Activity shows the same session's history, not persistent historical claims.
- [ ] Connect stop to existing stopAdminSync and abort local observation only after successful stop; guard replacement streams by controller identity. Refresh authoritative provider counts at completion/stop, retaining null values and error handling. Announce status changes politely without re-announcing every row on every update.
- [ ] Run sync/controller/admin tests and typecheck; inspect a mocked active stream in the browser with image/video files and a disconnect. Commit as `feat: show active indexing across providers`.

## Task 9: Tag management, item browsing, and nested confirmation

**Files:** Create `features/admin/ApprovedTagsPanel.tsx`, `.module.css`, `.test.tsx`, `ProviderItemsDialog.tsx`, `.module.css`, `.test.tsx`; modify `AdminWorkspace.tsx`, `useProviderItems.ts`, `useApprovedTags.ts`, `components/AdminPage.test.tsx`.

**Interfaces:** `ApprovedTagsPanel({ model }: { model: ReturnType<typeof useApprovedTags> }): JSX.Element`; `ProviderItemsDialog({ model, providers }: { model: ReturnType<typeof useProviderItems>; providers: readonly ProviderDashboardStatus[] }): JSX.Element`. Use shared Dialog for both browsing and nested deletion confirmation.

- [ ] Test `saved approval survives load and category expansion`, `discovery preserves only still-valid selections`, `save sends discovered and approved full tag IDs`, `Cancel never deletes`, `confirmation Escape returns focus to Delete in parent dialog`, `delete success removes exact point ID`, and `unknown filename falls back to point_id`. During an in-flight delete, prevent duplicate confirmation and preserve pending state on error. Verify session expiry hides both dialogs.
- [ ] Run the two new panel suites plus controller/AdminPage tests; expect new imports/assertions to fail initially.
- [ ] Render tag categories with React Aria Disclosure/Checkbox primitives styled in ApprovedTagsPanel.module.css; retain discovery counts, selection summary, clear, Save, loading/error feedback. Keep session sign-out and refresh status in Settings using existing hooks.
- [ ] Render browsing with a semantic list or intentionally scrollable table, labeled action buttons, exact item identification, and nested alertdialog confirmation. Remove custom backdrop/stopPropagation/Escape effects. Preserve the current deletion endpoint and retain the reindex API helper without adding a new action.
- [ ] Run panel/controller/admin tests, typecheck, and browser keyboard checks for nested dialogs. Commit as `feat: redesign admin tags and item management`.

## Task 10: Remove legacy UI/CSS and validate the whole app

**Files:** Modify `main.tsx`, `App.tsx`, `App.test.tsx`, `frontend/package.json`, `frontend/package-lock.json`, and tests importing removed files. Delete `styles.css`, obsolete `components/SearchPanel.tsx`, `AdminPage.tsx`, `AdminNavigation.tsx`, `AdminProviderCard.tsx`, `AdminSyncActivityPanel.tsx`, `AdminLoginBackground.tsx` and obsolete tests only after replacement coverage exists. Preserve tests of current behavior by moving them into feature suites. Review `tests/test_frontend_mockup_animation.py` before changing any assertion referencing intentionally removed animation.

**Interfaces:** App's public component remains `App(): JSX.Element`; it renders SearchWorkspace under AppShell and lazy AdminWorkspace. The final bootstrap imports tokens/global only. No compatibility reexports or legacy CSS globals are required.

- [ ] Update route integration tests to direct feature imports and assert public search, admin session/login, all five sections, combined filters, and visible active-file status across the final app. Keep deferred/race tests from earlier tasks. Remove tests whose only requirement was the retired decorative animation, documenting that approved design change.
- [ ] Run the affected tests before wiring final imports, confirming failures refer to the intended old/new boundaries rather than missing mocks or timing issues.
- [ ] Replace adapters with direct imports while preserving the admin dynamic import. Delete old stylesheet and unused presentation files. Remove Three.js/@types/three only if codebase-memory plus a targeted import check confirms the login background was their only consumer; regenerate package-lock via npm. Do not remove logo or thumbnail logic.
- [ ] Use `rg` for permitted literal checks: old `styles.css` imports, obsolete class-name strings, Three.js imports, and global CSS imports. Inspect any result before deleting it. Check CSS ownership: no cross-feature global selectors, no copied full legacy blocks, no page styles in global.css. CSS line count alone is not a pass/fail criterion.
- [ ] Run `npm --prefix frontend test -- --run`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run build`, and `git diff --check`. Require successful exits; any unrelated baseline failures must be documented explicitly, not silently excluded. Run targeted Python checks only if their files changed.
- [ ] Open the built app or Vite app in the browser and verify 390, 937, and 1440px widths: long filenames, table overflow containment, one navigation set, one Filters trigger, draft discard, dialogs/focus, signed-out and expired sessions, model unavailable, unknown counts, active indexing, failed/stopped streams, no active jobs, and reduced motion. Use a local controlled API fixture if live services are unavailable; clearly label fixture-based evidence and never modify production data for validation. Save screenshots of search, admin active jobs, login, and mobile navigation.
- [ ] Check the built bundle retains admin code splitting and excludes retired animation dependencies. Commit as `refactor: remove legacy UI styles and complete redesign`. Report test/build/browser evidence and any environment limitations. Do not claim completion while a screen still depends on legacy CSS.

## Self-review and handoff

Coverage: shell/session (2), controls/accessibility (1, 4, 9), search preservation (3–5), admin capabilities/models/counts (6–7, 9), current indexing (8), whole-app CSS cleanup and responsiveness (10). Review Focus items each have explicit owning test steps. The plan intentionally uses existing API signatures and optional media fallbacks rather than adding backend scope.

Execute tasks in order; later tasks depend on the named interfaces above. Use task-sized commits and local review; no remote push. Current user authorization covers writing this plan, not starting implementation. Ask for plan review and execution method before Task 1. Native execution is recommended because these ten tasks migrate tightly related controllers/components and share interface changes; use independent review at completion. If the user chooses subagent-driven execution, use that skill's task and review gates instead.

References: [React Aria installation and styling](https://react-aria.adobe.com/getting-started), [Tabs](https://react-aria.adobe.com/Tabs). Verify exact exported types against the installed package during Task 1; website sample components can be wrappers rather than package exports.
