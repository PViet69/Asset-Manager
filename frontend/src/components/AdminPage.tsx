import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  deleteAdminQdrantPoint,
  discoverAdminTags,
  getAdminProviderItems,
  getAdminSession,
  getAdminSyncStatus,
  getAdminTags,
  loginAdmin,
  logoutAdmin,
  refreshAdminProvider,
  saveAdminTags,
  stopAdminSync,
  streamAdminSync,
} from "../api/client";
import type {
  ModelHealthStatus,
  ProviderDashboardStatus,
  QdrantItem,
  TagGroup,
  SyncActivityEvent,
} from "../types";
import { AdminModelHealth } from "./AdminModelHealth";
import { AdminNavigation, type AdminTab } from "./AdminNavigation";
import { AdminProviderCard } from "./AdminProviderCard";

const SAFE_SYNC_ERROR = "Provider sync failed. Try again.";
const AdminLoginBackground = lazy(() =>
  import("./AdminLoginBackground").then(({ AdminLoginBackground: Background }) => ({
    default: Background,
  }))
);

type DashboardState = {
  readonly providers: readonly ProviderDashboardStatus[];
  readonly embeddingModel: ModelHealthStatus | null;
  readonly descriptionModel: ModelHealthStatus | null;
};

type Toast = {
  readonly id: string;
  readonly type: "status" | "error";
  readonly message: string;
  readonly isDismissing?: boolean;
};

type PendingDeletion = {
  readonly providerId: string;
  readonly item: QdrantItem;
};

const EMPTY_DASHBOARD: DashboardState = {
  providers: [],
  embeddingModel: null,
  descriptionModel: null,
};

function dashboardFrom(response: Awaited<ReturnType<typeof getAdminSyncStatus>>): DashboardState {
  return {
    providers: response.providers,
    embeddingModel: response.embedding_model,
    descriptionModel: response.description_model,
  };
}

function headingForTab(tab: AdminTab): string {
  return tab === "dashboards" ? "Overview" : tab === "logs" ? "Activity" : tab.charAt(0).toUpperCase() + tab.slice(1);
}

export function AdminPage(): JSX.Element {
  document.title = "Admin Dashboard";
  const isAdminRoute = typeof window !== "undefined" && ["/admin", "/admin/dashboard"].includes(window.location.pathname);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(isAdminRoute);
  const [dashboard, setDashboard] = useState<DashboardState>(EMPTY_DASHBOARD);
  const [refreshingProviders, setRefreshingProviders] = useState<ReadonlySet<string>>(new Set());
  const [syncingProviders, setSyncingProviders] = useState<ReadonlySet<string>>(new Set());
  const [activityByProvider, setActivityByProvider] = useState<Readonly<Record<string, readonly SyncActivityEvent[]>>>({});
  const [openActivityProviders, setOpenActivityProviders] = useState<ReadonlySet<string>>(new Set());
  const [deletingProviders, setDeletingProviders] = useState<ReadonlySet<string>>(new Set());
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null);
  const [itemsByProvider, setItemsByProvider] = useState<Readonly<Record<string, readonly QdrantItem[] | null>>>({});
  const [openItemsProvider, setOpenItemsProvider] = useState<string | null>(null);
  const [loadingItemsProviders, setLoadingItemsProviders] = useState<ReadonlySet<string>>(new Set());
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);
  const [dashboardEpoch, setDashboardEpoch] = useState(0);
  const [activeTab, setActiveTab] = useState<AdminTab>("dashboards");
  const [selectedChartProvider, setSelectedChartProvider] = useState<string>("all");
  const [isMobileNavigationOpen, setIsMobileNavigationOpen] = useState(false);
  const [discoveredTagGroups, setDiscoveredTagGroups] = useState<readonly TagGroup[]>([]);
  const [selectedApprovedTags, setSelectedApprovedTags] = useState<readonly string[]>([]);
  const [expandedTagCategories, setExpandedTagCategories] = useState<ReadonlySet<string>>(new Set());
  const [isDiscoveringTags, setIsDiscoveringTags] = useState(false);
  const [isSavingTags, setIsSavingTags] = useState(false);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const hasLoadedApprovedTags = useRef(false);
  const [toasts, setToasts] = useState<readonly Toast[]>([]);
  const controllers = useRef<Record<string, AbortController>>({});

  const addToast = useCallback((message: string, type: Toast["type"]): void => {
    const id = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => setToasts((current) => current.map((toast) => toast.id === id ? { ...toast, isDismissing: true } : toast)), 4500);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4900);
  }, []);

  function clearSession(): void {
    setIsAuthenticated(false);
    setIsMobileNavigationOpen(false);
    setDashboard(EMPTY_DASHBOARD);
    setSyncingProviders(new Set());
    setDiscoveredTagGroups([]);
    setSelectedApprovedTags([]);
    setExpandedTagCategories(new Set());
    hasLoadedApprovedTags.current = false;
    if (window.location.pathname.startsWith("/admin")) window.history.replaceState({}, "", "/admin/login");
  }

  function handleAdminError(caught: unknown, fallback: string, clearOn401 = true): void {
    if (clearOn401 && caught instanceof ApiError && caught.status === 401) {
      clearSession();
      return;
    }
    addToast(caught instanceof ApiError ? caught.message : fallback, "error");
  }

  async function loadDashboard(): Promise<void> {
    setIsLoadingDashboard(true);
    try {
      setDashboard(dashboardFrom(await getAdminSyncStatus()));
      setDashboardEpoch((current) => current + 1);
    } catch (caught) {
      handleAdminError(caught, "Could not load status");
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  async function loadSavedTags(): Promise<void> {
    setIsLoadingTags(true);
    try {
      const response = await getAdminTags();
      const approved = response.groups.flatMap((group) => group.tags);
      setSelectedApprovedTags(approved);
      setDiscoveredTagGroups((current) => (current.length === 0 ? response.groups : current));
      hasLoadedApprovedTags.current = true;
      if (response.groups.length > 0) {
        setExpandedTagCategories((current) => {
          if (current.size > 0) return current;
          return new Set(response.groups.map((group) => group.category));
        });
      }
    } catch (caught) {
      handleAdminError(caught, "Could not load approved tags");
    } finally {
      setIsLoadingTags(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await getAdminSession();
        setIsAuthenticated(true);
        if (window.location.pathname === "/admin" || window.location.pathname === "/admin/login") window.history.replaceState({}, "", "/admin/dashboard");
        await loadDashboard();
        await loadSavedTags();
      } catch (caught) {
        if (window.location.pathname === "/admin" || window.location.pathname === "/admin/dashboard") window.history.replaceState({}, "", "/admin/login");
        handleAdminError(caught, "Could not restore session");
      }
    })();
    return () => Object.values(controllers.current).forEach((controller) => controller.abort());
  }, []);

  useEffect(() => {
    if (isAuthenticated && activeTab === "settings" && !hasLoadedApprovedTags.current) {
      void loadSavedTags();
    }
  }, [isAuthenticated, activeTab]);

  async function handleLogin(enteredUsername: string, enteredPassword: string): Promise<void> {
    setLoginError(null);
    try {
      await loginAdmin(enteredUsername, enteredPassword);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.status === 401) {
          setLoginError("The login information you entered is incorrect.");
        } else if (caught.status === 429) {
          setLoginError("Too many login attempts. Please wait 5 seconds and try again.");
        } else {
          setLoginError(caught.message || "Could not sign in. Please try again.");
        }
      } else {
        setLoginError("The login information you entered is incorrect.");
      }
      return;
    }

    setIsAuthenticated(true);
    window.history.pushState({}, "", "/admin/dashboard");
    await loadDashboard();
    await loadSavedTags();
  }

  async function handleLogout(): Promise<void> {
    try {
      await logoutAdmin();
    } catch {
      // Session is cleared locally even when remote logout fails.
    } finally {
      clearSession();
    }
  }

  async function refreshProvider(providerId: string): Promise<void> {
    setRefreshingProviders((current) => new Set(current).add(providerId));
    try {
      const response = await refreshAdminProvider(providerId);
      setDashboard((current) => ({
        ...current,
        providers: current.providers.map((provider) => provider.provider === providerId ? response.provider : provider),
        embeddingModel: response.embedding_model,
        descriptionModel: response.description_model,
      }));
      setDashboardEpoch((current) => current + 1);
    } catch (caught) {
      handleAdminError(caught, "Could not refresh provider");
    } finally {
      setRefreshingProviders((current) => new Set([...current].filter((item) => item !== providerId)));
    }
  }

  function toggleActivity(providerId: string): void {
    setOpenActivityProviders((current) => current.has(providerId)
      ? new Set([...current].filter((item) => item !== providerId))
      : new Set(current).add(providerId));
  }

  async function openProviderItems(providerId: string): Promise<void> {
    setOpenItemsProvider(providerId);
    setLoadingItemsProviders((current) => new Set(current).add(providerId));
    try {
      const response = await getAdminProviderItems(providerId);
      setItemsByProvider((current) => ({ ...current, [providerId]: response.items }));
    } catch (caught) {
      setOpenItemsProvider(null);
      handleAdminError(caught, "Could not load embedded items");
    } finally {
      setLoadingItemsProviders((current) => new Set([...current].filter((item) => item !== providerId)));
    }
  }

  function closeProviderItems(): void {
    setOpenItemsProvider(null);
  }

  useEffect(() => {
    if (!openItemsProvider && !pendingDeletion) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (pendingDeletion && !deletingProviders.has(pendingDeletion.providerId)) {
        setPendingDeletion(null);
        return;
      }
      closeProviderItems();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [openItemsProvider, pendingDeletion, deletingProviders]);

  const openedItemsProvider = dashboard.providers.find((provider) => provider.provider === openItemsProvider) ?? null;
  const openedItems = openItemsProvider ? itemsByProvider[openItemsProvider] ?? null : null;
  const isOpenedItemsLoading = openItemsProvider ? loadingItemsProviders.has(openItemsProvider) : false;

  function renderItemsDialog(): JSX.Element | null {
    if (!openedItemsProvider || !openItemsProvider) return null;
    return (
      <div className="admin-items-modal-backdrop" onMouseDown={closeProviderItems}>
        <section
          className="admin-items-modal"
          role="dialog"
          aria-modal="true"
          aria-label={`${openedItemsProvider.display_name} embedded items`}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <header className="admin-items-modal__header">
            <div>
              <p>Embedded items</p>
              <h2>{openedItemsProvider.display_name}</h2>
            </div>
            <button type="button" className="admin-icon-button" onClick={closeProviderItems} aria-label="Close embedded items">
              ×
            </button>
          </header>
          <div className="admin-items-modal__content" aria-live="polite">
            {isOpenedItemsLoading ? <p>Loading embedded items…</p> : openedItems?.length === 0 ? <p>No embedded items.</p> : openedItems ? (
              <ul className="admin-item-list">
                {openedItems.map((item) => {
                  const itemName = item.filename || item.point_id;
                  return (
                    <li key={item.point_id}>
                      <span title={itemName}>{itemName}</span>
                      <button
                        type="button"
                        className="admin-delete-button"
                        onClick={() => setPendingDeletion({ providerId: openItemsProvider, item })}
                        disabled={deletingProviders.has(openItemsProvider)}
                        aria-label={`Delete ${itemName}`}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  async function deleteEmbeddedItem(): Promise<void> {
    if (!pendingDeletion) return;
    const { providerId, item } = pendingDeletion;
    const itemName = item.filename || item.point_id;
    setDeletingProviders((current) => new Set(current).add(providerId));
    try {
      await deleteAdminQdrantPoint(item.point_id);
      setItemsByProvider((current) => ({ ...current, [providerId]: (current[providerId] ?? []).filter((entry) => entry.point_id !== item.point_id) }));
      setPendingDeletion(null);
      addToast(`Deleted embedded item "${itemName}".`, "status");
      await loadDashboard();
    } catch (caught) {
      handleAdminError(caught, "Could not delete embedded item");
    } finally {
      setDeletingProviders((current) => new Set([...current].filter((entry) => entry !== providerId)));
    }
  }

  function renderDeleteConfirmationDialog(): JSX.Element | null {
    if (!pendingDeletion) return null;
    const itemName = pendingDeletion.item.filename || pendingDeletion.item.point_id;
    const isDeleting = deletingProviders.has(pendingDeletion.providerId);
    return (
      <div className="admin-items-modal-backdrop" onMouseDown={() => !isDeleting && setPendingDeletion(null)}>
        <section className="admin-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="admin-delete-confirmation-title" onMouseDown={(event) => event.stopPropagation()}>
          <p className="admin-confirmation-modal__eyebrow">Remove embedded source</p>
          <h2 id="admin-delete-confirmation-title">Remove {itemName}?</h2>
          <p>This removes this source from vector search. This action cannot be undone.</p>
          <div className="admin-confirmation-modal__actions">
            <button type="button" className="admin-link-button" onClick={() => setPendingDeletion(null)} disabled={isDeleting}>Cancel</button>
            <button type="button" className="admin-primary-button admin-primary-button--danger" onClick={() => void deleteEmbeddedItem()} disabled={isDeleting}>{isDeleting ? "Removing" : "Remove source"}</button>
          </div>
        </section>
      </div>
    );
  }

  function incrementProviderCoverage(providerId: string): void {
    setDashboard((current) => ({
      ...current,
      providers: current.providers.map((provider) => provider.provider !== providerId || provider.embedded_count === null
        ? provider
        : { ...provider, embedded_count: provider.embedded_count + 1 }),
    }));
  }

  async function syncProvider(providerId: string): Promise<void> {
    if (syncingProviders.has(providerId)) {
      controllers.current[providerId]?.abort();
      void stopAdminSync(providerId).catch(() => undefined);
      return;
    }
    const controller = new AbortController();
    const indexedFilenames = new Set<string>();
    controllers.current = { ...controllers.current, [providerId]: controller };
    setSyncingProviders((current) => new Set(current).add(providerId));
    setOpenActivityProviders((current) => new Set(current).add(providerId));
    setActivityByProvider((current) => ({ ...current, [providerId]: [] }));
    try {
      await streamAdminSync(providerId, (event) => {
        if (event.terminal) return;
        if (event.status === "done" && event.filename && !indexedFilenames.has(event.filename)) {
          indexedFilenames.add(event.filename);
          incrementProviderCoverage(providerId);
        }
        setActivityByProvider((current) => {
          const events = current[providerId] ?? [];
          const index = event.filename ? events.findIndex((item) => item.filename === event.filename) : -1;
          const nextEvents = index >= 0 ? events.map((item, itemIndex) => itemIndex === index ? event : item) : [event, ...events];
          return { ...current, [providerId]: nextEvents };
        });
      }, controller.signal);
      await loadDashboard();
    } catch (caught) {
      if (!controller.signal.aborted) handleAdminError(caught, SAFE_SYNC_ERROR);
    } finally {
      setSyncingProviders((current) => new Set([...current].filter((item) => item !== providerId)));
      const { [providerId]: _, ...rest } = controllers.current;
      controllers.current = rest;
    }
  }

  async function discoverTags(): Promise<void> {
    setIsDiscoveringTags(true);
    try {
      const [response, savedResponse] = await Promise.all([
        discoverAdminTags(),
        !hasLoadedApprovedTags.current ? getAdminTags().catch(() => null) : Promise.resolve(null),
      ]);
      const discoveredTags = new Set(response.groups.flatMap((group) => group.tags));
      const sourceApproved = hasLoadedApprovedTags.current
        ? selectedApprovedTags
        : (savedResponse?.groups.flatMap((group) => group.tags) ?? []);
      const nextApproved = sourceApproved.filter((tag) => discoveredTags.has(tag));

      hasLoadedApprovedTags.current = true;
      setDiscoveredTagGroups(response.groups);
      setSelectedApprovedTags(nextApproved);

      const categoriesWithSelected = new Set(
        response.groups
          .filter((group) => group.tags.some((tag) => nextApproved.includes(tag)))
          .map((group) => group.category)
      );
      setExpandedTagCategories((current) => new Set([...current, ...categoriesWithSelected]));
      addToast(`Indexed tags for ${response.indexed_assets} assets.`, "status");
    } catch (caught) {
      handleAdminError(caught, "Could not discover tags");
    } finally {
      setIsDiscoveringTags(false);
    }
  }

  function toggleApprovedTag(tag: string): void {
    setSelectedApprovedTags((current) => current.includes(tag)
      ? current.filter((selected) => selected !== tag)
      : [...current, tag]);
  }

  function toggleTagCategory(category: string): void {
    setExpandedTagCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  async function saveApprovedTags(): Promise<void> {
    const discoveredTags = discoveredTagGroups.flatMap((group) => group.tags);
    setIsSavingTags(true);
    try {
      const response = await saveAdminTags(discoveredTags, selectedApprovedTags);
      const approved = response.groups.flatMap((group) => group.tags);
      setSelectedApprovedTags(approved);
      addToast("Approved tags saved.", "status");
    } catch (caught) {
      handleAdminError(caught, "Could not save approved tags");
    } finally {
      setIsSavingTags(false);
    }
  }

  function selectTab(tab: AdminTab): void {
    setActiveTab(tab);
    setIsMobileNavigationOpen(false);
  }

  function renderProviders(): JSX.Element {
    if (isLoadingDashboard) {
      return (
        <section className="admin-provider-grid" aria-label="Storage providers" aria-busy="true">
          {["provider-a", "provider-b"].map((key) => (
            <article className="admin-provider-card admin-skeleton-card" key={key} aria-hidden="true">
              <div className="admin-provider-card__header">
                <span className="admin-skeleton admin-skeleton--icon" />
                <span className="admin-skeleton admin-skeleton--status" />
              </div>
              <div className="admin-skeleton admin-skeleton--provider-name" />
              <div className="admin-provider-card__index">
                <span className="admin-skeleton admin-skeleton--metric" />
                <span className="admin-skeleton admin-skeleton--metric" />
              </div>
              <div className="admin-skeleton admin-skeleton--action" />
            </article>
          ))}
        </section>
      );
    }

    return (
      <section className="admin-provider-grid" aria-label="Storage providers">
        {dashboard.providers.map((provider) => (
          <AdminProviderCard
            key={provider.provider}
            provider={provider}
            events={activityByProvider[provider.provider] ?? []}
            isRefreshing={refreshingProviders.has(provider.provider)}
            isSyncing={syncingProviders.has(provider.provider)}
            isItemsLoading={loadingItemsProviders.has(provider.provider)}
            isActivityOpen={openActivityProviders.has(provider.provider)}
            onRefresh={(providerId) => void refreshProvider(providerId)}
            onOpenItems={(providerId) => void openProviderItems(providerId)}
            onSync={(providerId) => void syncProvider(providerId)}
            onToggleActivity={toggleActivity}
          />
        ))}
      </section>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="admin-shell admin-login-shell">
        <Suspense fallback={null}>
          <AdminLoginBackground />
        </Suspense>
        <div className="admin-login-layout">
          <aside className="admin-login-intro" aria-label="Asset Manager administration">
            <a className="admin-login-brand" href="/" aria-label="Asset Manager home">
              <span className="admin-login-brand-mark" aria-hidden="true"><span /></span>
              <span>Asset Manager</span>
            </a>
            <div className="admin-login-intro-copy">
              <p className="admin-login-eyebrow">Administration</p>
              <h1>Asset operations <em>under control</em></h1>
              <p>Monitor storage, manage indexing, and keep your visual archive ready for every team.</p>
            </div>
          </aside>

          <section className="admin-login-card" aria-labelledby="admin-login-heading">
            <div className="admin-login-card-header">
              <p className="admin-login-eyebrow">Secure access</p>
              <h2 id="admin-login-heading">Admin sign in</h2>
            </div>
            {loginError && (
              <div className="admin-login-error" role="alert">
                <svg
                  className="admin-login-error-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{loginError}</span>
              </div>
            )}
            <AdminLoginForm onSubmit={handleLogin} onClearError={() => setLoginError(null)} />
            <p className="admin-login-footer">Restricted to authorized workspace administrators.</p>
            <ToastList toasts={toasts} />
          </section>
        </div>
      </main>
    );
  }

  return (
    <div className="admin-shell">
      <AdminNavigation activeTab={activeTab} isMobileOpen={isMobileNavigationOpen} onSelectTab={selectTab} onCloseMobile={() => setIsMobileNavigationOpen(false)} />
      <main className="admin-content">
        <header className="admin-topbar">
          <button type="button" className="admin-menu-button" onClick={() => setIsMobileNavigationOpen(true)} aria-label="Open navigation">Menu</button>
          <div>
            <h1>{headingForTab(activeTab)}</h1>
          </div>
          <button type="button" className="admin-link-button" onClick={() => void handleLogout()}>Sign out</button>
        </header>

        {activeTab === "dashboards" ? (() => {
          if (isLoadingDashboard) {
            return (
              <section className="admin-metrics-grid" aria-label="Key operational metrics" aria-busy="true">
                <article className="admin-metric-panel admin-chart-panel admin-skeleton-card" aria-hidden="true">
                  <header className="admin-panel-header">
                    <div>
                      <span className="admin-skeleton admin-skeleton--label" />
                      <div className="admin-panel-metric-row">
                        <span className="admin-skeleton admin-skeleton--metric-val" />
                        <span className="admin-skeleton admin-skeleton--trend" />
                      </div>
                    </div>
                    <div className="admin-provider-tabs">
                      <span className="admin-skeleton admin-skeleton--tab-chip" />
                      <span className="admin-skeleton admin-skeleton--tab-chip" />
                    </div>
                  </header>

                  <div className="admin-chart-viewport">
                    <div className="admin-skeleton-chart-bars">
                      <span className="admin-skeleton admin-skeleton--bar" style={{ height: "65%" }} />
                      <span className="admin-skeleton admin-skeleton--bar" style={{ height: "90%" }} />
                      <span className="admin-skeleton admin-skeleton--bar" style={{ height: "45%" }} />
                    </div>
                  </div>

                  <footer className="admin-panel-footer">
                    <div className="admin-chart-legend">
                      <span className="admin-skeleton admin-skeleton--legend" />
                      <span className="admin-skeleton admin-skeleton--legend" />
                    </div>
                  </footer>
                </article>

                <article className="admin-metric-panel admin-coverage-panel admin-skeleton-card" aria-hidden="true">
                  <header className="admin-panel-header">
                    <div>
                      <span className="admin-skeleton admin-skeleton--label" />
                      <span className="admin-skeleton admin-skeleton--desc" />
                    </div>
                  </header>

                  <div className="admin-coverage-card-body">
                    <div className="admin-coverage-visual-stage">
                      <div className="admin-skeleton admin-skeleton--gauge" />
                    </div>

                    <div className="admin-coverage-ledger">
                      <div className="admin-coverage-ledger-row">
                        <span className="admin-skeleton admin-skeleton--ledger-row" />
                      </div>
                      <div className="admin-coverage-ledger-row">
                        <span className="admin-skeleton admin-skeleton--ledger-row" />
                      </div>
                    </div>
                  </div>
                </article>
              </section>
            );
          }

          const totalDetected = dashboard.providers.reduce((acc, p) => acc + (p.detected_count ?? 0), 0);
          const totalEmbedded = dashboard.providers.reduce((acc, p) => acc + (p.embedded_count ?? 0), 0);
          const coveragePct = totalDetected > 0 ? Math.round((totalEmbedded / totalDetected) * 100) : 0;
          const pendingFiles = Math.max(0, totalDetected - totalEmbedded);
          const coverageCircumference = 264;
          const coverageOffset = totalDetected > 0 ? Math.max(0, coverageCircumference - (coverageCircumference * coveragePct) / 100) : coverageCircumference;

          const selectedProvider = selectedChartProvider !== "all"
            ? dashboard.providers.find((p) => p.provider === selectedChartProvider)
            : null;

          type ChartBarItem = {
            key: string;
            label: string;
            subLabel: string;
            val: number;
            pct: number;
            embeddedPct?: number;
            active?: boolean;
            fillClass?: string;
            tooltip: string;
          };

          let chartBars: ChartBarItem[] = [];
          let yMax = 0;

          if (selectedProvider) {
            const detected = selectedProvider.detected_count ?? 0;
            const embedded = selectedProvider.embedded_count ?? 0;
            const pending = Math.max(0, detected - embedded);
            yMax = Math.max(detected, 1);

            chartBars = [
              {
                key: "detected",
                label: "Detected",
                subLabel: `${detected} total`,
                val: detected,
                pct: detected > 0 ? 100 : 4,
                fillClass: "admin-chart-bar-fill--detected",
                tooltip: `${selectedProvider.display_name} - Detected: ${detected}`,
              },
              {
                key: "indexed",
                label: "Indexed",
                subLabel: `${detected > 0 ? Math.round((embedded / detected) * 100) : 0}%`,
                val: embedded,
                pct: detected > 0 ? Math.max(4, Math.round((embedded / yMax) * 100)) : 4,
                fillClass: "admin-chart-bar-fill--indexed",
                active: true,
                tooltip: `${selectedProvider.display_name} - Indexed: ${embedded} files`,
              },
              {
                key: "pending",
                label: "Pending",
                subLabel: `${detected > 0 ? Math.round((pending / detected) * 100) : 0}%`,
                val: pending,
                pct: detected > 0 ? Math.max(4, Math.round((pending / yMax) * 100)) : 4,
                fillClass: "admin-chart-bar-fill--pending",
                tooltip: `${selectedProvider.display_name} - Pending intake: ${pending} files`,
              },
            ];
          } else if (dashboard.providers.length === 1 && dashboard.providers[0]) {
            const p = dashboard.providers[0];
            const detected = p.detected_count ?? 0;
            const embedded = p.embedded_count ?? 0;
            const pending = Math.max(0, detected - embedded);
            yMax = Math.max(detected, 1);

            chartBars = [
              {
                key: "detected",
                label: "Detected",
                subLabel: `${detected} total`,
                val: detected,
                pct: detected > 0 ? 100 : 4,
                fillClass: "admin-chart-bar-fill--detected",
                tooltip: `${p.display_name} - Detected: ${detected}`,
              },
              {
                key: "indexed",
                label: "Indexed",
                subLabel: `${detected > 0 ? Math.round((embedded / detected) * 100) : 0}%`,
                val: embedded,
                pct: detected > 0 ? Math.max(4, Math.round((embedded / yMax) * 100)) : 4,
                fillClass: "admin-chart-bar-fill--indexed",
                active: true,
                tooltip: `${p.display_name} - Indexed: ${embedded} files`,
              },
              {
                key: "pending",
                label: "Pending",
                subLabel: `${detected > 0 ? Math.round((pending / detected) * 100) : 0}%`,
                val: pending,
                pct: detected > 0 ? Math.max(4, Math.round((pending / yMax) * 100)) : 4,
                fillClass: "admin-chart-bar-fill--pending",
                tooltip: `${p.display_name} - Pending intake: ${pending} files`,
              },
            ];
          } else if (dashboard.providers.length > 1) {
            yMax = Math.max(...dashboard.providers.map((p) => p.detected_count ?? 0), 1);

            chartBars = dashboard.providers.map((p) => {
              const detected = p.detected_count ?? 0;
              const embedded = p.embedded_count ?? 0;
              const pending = Math.max(0, detected - embedded);
              const heightPct = detected > 0 ? Math.max(8, Math.round((detected / yMax) * 100)) : 4;
              const embeddedPct = detected > 0 ? Math.round((embedded / detected) * 100) : 0;

              return {
                key: p.provider,
                label: p.display_name,
                subLabel: `${embedded}/${detected}`,
                val: detected,
                pct: heightPct,
                embeddedPct: embeddedPct,
                fillClass: "admin-chart-bar-fill--stacked",
                tooltip: `${p.display_name}: ${detected} detected (${embedded} indexed, ${pending} pending)`,
              };
            });
          }

          return (
            <section className="admin-metrics-grid" aria-label="Key operational metrics">
              {/* 1. Dedicated Real Assets Detected Breakdown Chart */}
              <article className="admin-metric-panel admin-chart-panel">
                <header className="admin-panel-header">
                  <div>
                    <span className="admin-panel-label">Assets detected</span>
                    <div className="admin-panel-metric-row">
                      <strong className="admin-panel-metric-val">
                        {selectedProvider ? (selectedProvider.detected_count ?? 0) : totalDetected}
                      </strong>
                      <span className="admin-trend-badge admin-trend-badge--blue">
                        {selectedProvider
                          ? `${selectedProvider.embedded_count ?? 0}/${selectedProvider.detected_count ?? 0} indexed`
                          : `${dashboard.providers.length} provider${dashboard.providers.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </div>
                  <div className="admin-provider-tabs" role="tablist" aria-label="Provider chart filter">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selectedChartProvider === "all"}
                      className={`admin-tab-chip ${selectedChartProvider === "all" ? "admin-tab-chip--active" : ""}`}
                      onClick={() => setSelectedChartProvider("all")}
                    >
                      All ({totalDetected})
                    </button>
                    {dashboard.providers.map((p) => (
                      <button
                        key={p.provider}
                        type="button"
                        role="tab"
                        aria-selected={selectedChartProvider === p.provider}
                        className={`admin-tab-chip ${selectedChartProvider === p.provider ? "admin-tab-chip--active" : ""}`}
                        onClick={() => setSelectedChartProvider(p.provider)}
                        title={p.display_name}
                      >
                        {p.display_name} ({p.detected_count ?? 0})
                      </button>
                    ))}
                  </div>
                </header>

                <div className="admin-chart-viewport" aria-label="Assets breakdown chart">
                  <div className="admin-chart-grid" aria-hidden="true">
                    <div className="admin-chart-grid-line"><span>{yMax}</span></div>
                    <div className="admin-chart-grid-line"><span>{Math.round(yMax / 2)}</span></div>
                    <div className="admin-chart-grid-line"><span>0</span></div>
                  </div>

                  {chartBars.length === 0 ? (
                    <div className="admin-chart-empty">No storage providers configured</div>
                  ) : (
                    <div key={`chart-${dashboardEpoch}-${selectedChartProvider}`} className="admin-timeline-chart">
                      {chartBars.map((bar, colIdx) => {
                        const isClickable = selectedChartProvider === "all" && dashboard.providers.some((p) => p.provider === bar.key);
                        return (
                          <div
                            key={bar.key}
                            className={`admin-chart-col ${bar.active ? "active" : ""}`}
                            title={bar.tooltip}
                            onClick={() => {
                              if (isClickable) {
                                setSelectedChartProvider(bar.key);
                              }
                            }}
                            style={{
                              cursor: isClickable ? "pointer" : "default",
                              "--col-index": colIdx,
                            } as React.CSSProperties}
                          >
                            <span className="admin-chart-val-label">{bar.val}</span>
                            <div className="admin-chart-bar-wrap">
                              <div className="admin-chart-bar-bg" />
                              <div
                                className={`admin-chart-bar-fill ${bar.fillClass ?? ""}`}
                                style={{ height: `${bar.pct}%` }}
                              >
                                {bar.embeddedPct !== undefined ? (
                                  <div
                                    className="admin-chart-segment-embedded"
                                    style={{ height: `${bar.embeddedPct}%` }}
                                  />
                                ) : null}
                              </div>
                            </div>
                            <span className="admin-chart-axis-label">{bar.label}</span>
                            <span className="admin-chart-axis-sub">{bar.subLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <footer className="admin-panel-footer">
                  <div className="admin-chart-legend">
                    <span className="admin-chart-legend-item"><span className="admin-chart-dot indexed" />Indexed</span>
                    <span className="admin-chart-legend-item"><span className="admin-chart-dot pending" />Pending</span>
                  </div>
                </footer>
              </article>

              {/* 2. Dedicated Index Coverage Gauge Card */}
              <article className="admin-metric-panel admin-coverage-panel">
                <header className="admin-panel-header">
                  <div>
                    <span className="admin-panel-label">Index coverage</span>
                    <span className="admin-status-desc">Vector embeddings health</span>
                  </div>
                </header>

                <div className="admin-coverage-card-body">
                  <div key={`gauge-${dashboardEpoch}-${coveragePct}`} className="admin-coverage-visual-stage">
                    <svg className="admin-coverage-chart-svg" viewBox="0 0 100 100" aria-hidden="true">
                      <defs>
                        <linearGradient id="adminCoverageGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#3b82f6" />
                          <stop offset="100%" stopColor="#1d4ed8" />
                        </linearGradient>
                      </defs>
                      <circle className="admin-coverage-meter-track" cx="50" cy="50" r="42" />
                      <circle className="admin-coverage-meter-pending" cx="50" cy="50" r="42" />
                      <circle
                        className="admin-coverage-meter-indexed"
                        cx="50"
                        cy="50"
                        r="42"
                        style={{
                          strokeDashoffset: coverageOffset,
                          ["--target-offset" as string]: coverageOffset,
                        }}
                      />
                    </svg>
                    <div className="admin-coverage-visual-center">
                      <span className="admin-coverage-pct">{coveragePct}<span className="admin-coverage-pct-unit">%</span></span>
                    </div>
                  </div>

                  <div className="admin-coverage-ledger">
                    <div className="admin-coverage-ledger-row">
                      <span className="admin-stat-label"><span className="admin-stat-dot indexed" />Indexed files</span>
                      <strong className="admin-stat-val">
                        {totalEmbedded} <small>/ {totalDetected}</small>
                      </strong>
                    </div>
                    <div className="admin-coverage-ledger-row">
                      <span className="admin-stat-label"><span className="admin-stat-dot pending" />Pending intake</span>
                      <strong className="admin-stat-val alert">
                        {pendingFiles} files
                      </strong>
                    </div>
                  </div>
                </div>
              </article>
            </section>
          );
        })() : null}

        {activeTab === "dashboards" || activeTab === "providers" ? renderProviders() : null}
        {activeTab === "dashboards" || activeTab === "models" ? <AdminModelHealth embeddingModel={dashboard.embeddingModel} descriptionModel={dashboard.descriptionModel} isLoading={isLoadingDashboard} /> : null}
        {activeTab === "logs" ? (
          <section className="admin-log-panel" aria-label="Sync activity logs">
            {Object.values(activityByProvider).flat().length === 0 ? <p>No activity in this session.</p> : (
              <ul className="admin-activity-list">
                {Object.entries(activityByProvider).flatMap(([providerId, events]) => events.map((event) => <li key={`${providerId}-${event.sequence}`}>{event.filename ?? event.detail}</li>))}
              </ul>
            )}
          </section>
        ) : null}
        {activeTab === "settings" ? (
          <section className="admin-settings-grid" aria-label="Admin settings">
            <article><h2>Session</h2><button type="button" className="admin-link-button" onClick={() => void handleLogout()}>Sign out</button></article>
            <article><h2>Status</h2><button type="button" className="admin-primary-button" onClick={() => { void loadDashboard(); void loadSavedTags(); }} disabled={isLoadingDashboard}>{isLoadingDashboard ? "Refreshing" : "Refresh status"}</button></article>
            <article className="admin-tag-manager">
              <div className="admin-tag-manager__heading">
                <div>
                  <h2>Tag management</h2>
                  <p>Discover content tags, then select tags to approve for search.</p>
                </div>
                <button type="button" className="admin-primary-button" onClick={() => void discoverTags()} disabled={isDiscoveringTags}>
                  {isDiscoveringTags ? "Discovering tags" : "Discover and index tags"}
                </button>
              </div>
              {isLoadingTags && discoveredTagGroups.length === 0 ? (
                <p className="admin-status-desc">Loading saved tags…</p>
              ) : discoveredTagGroups.length > 0 ? (
                <>
                  <div className="admin-tag-selection-summary" aria-live="polite">
                    <strong>{selectedApprovedTags.length === 1 ? "1 tag selected" : selectedApprovedTags.length > 1 ? `${selectedApprovedTags.length} tags selected` : "No tags selected"}</strong>
                    <button type="button" className="admin-link-button" onClick={() => setSelectedApprovedTags([])} disabled={selectedApprovedTags.length === 0}>
                      Clear selection
                    </button>
                  </div>
                  <div className="admin-tag-categories">
                    {discoveredTagGroups.map((group) => {
                      const selectedCount = group.tags.filter((tag) => selectedApprovedTags.includes(tag)).length;
                      const isExpanded = expandedTagCategories.has(group.category);
                      return (
                        <section key={group.category} className="admin-tag-category">
                          <button
                            type="button"
                            className="admin-tag-category__trigger"
                            aria-expanded={isExpanded}
                            aria-controls={`tag-category-${group.category}`}
                            onClick={() => toggleTagCategory(group.category)}
                          >
                            <span>{group.category}</span>
                            <span>{selectedCount} selected</span>
                          </button>
                          {isExpanded ? (
                            <div id={`tag-category-${group.category}`} className="admin-tag-category__tags">
                              {group.tags.map((tag) => {
                                const isSelected = selectedApprovedTags.includes(tag);
                                return (
                                  <button
                                    key={tag}
                                    type="button"
                                    className={`admin-tag-chip ${isSelected ? "admin-tag-chip--selected" : ""}`}
                                    aria-pressed={isSelected}
                                    onClick={() => toggleApprovedTag(tag)}
                                  >
                                    {tag.split(":", 2)[1] ?? tag}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                        </section>
                      );
                    })}
                  </div>
                  <div className="admin-tag-manager__actions">
                    <button
                      type="button"
                      className="admin-primary-button"
                      onClick={() => void saveApprovedTags()}
                      disabled={isSavingTags}
                    >
                      {isSavingTags ? "Saving approved tags" : "Save approved tags"}
                    </button>
                  </div>
                </>
              ) : null}
            </article>
          </section>
        ) : null}
        {renderItemsDialog()}
        {renderDeleteConfirmationDialog()}
        <ToastList toasts={toasts} />
      </main>
    </div>
  );
}

function ToastList({ toasts }: { readonly toasts: readonly Toast[] }): JSX.Element {
  return (
    <div className="admin-toast-list" aria-live="polite">
      {toasts.map((toast) => <div key={toast.id} className={`admin-toast admin-toast--${toast.type} ${toast.isDismissing ? "admin-toast--dismissing" : ""}`} role={toast.type === "error" ? "alert" : "status"}>{toast.message}</div>)}
    </div>
  );
}

interface AdminLoginFormProps {
  readonly onSubmit: (username: string, password: string) => Promise<void>;
  readonly onClearError: () => void;
}

function AdminLoginForm({ onSubmit, onClearError }: AdminLoginFormProps): JSX.Element {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await onSubmit(username, password);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="admin-login-field">
        <label htmlFor="admin-username">Username</label>
        <input
          id="admin-username"
          name="username"
          autoComplete="username"
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            onClearError();
          }}
          required
        />
      </div>
      <div className="admin-login-field">
        <label htmlFor="admin-password">Password</label>
        <input
          id="admin-password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            onClearError();
          }}
          required
        />
      </div>
      <button className="admin-primary-button admin-login-submit" type="submit">
        <span>Sign in</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}

