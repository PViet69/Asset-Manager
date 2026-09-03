import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  deleteAdminQdrantPoint,
  getAdminProviderItems,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
  logoutAdmin,
  refreshAdminProvider,
  reindexAdminStorageFile,
  stopAdminSync,
  streamAdminSync,
} from "../api/client";

import type {
  ModelHealthStatus,
  ProviderDashboardStatus,
  QdrantItem,
  SyncActivityEvent,
} from "../types";


const safeError = "Provider sync failed. Try again.";

type DashboardState = {
  providers: ProviderDashboardStatus[];
  embeddingModel: ModelHealthStatus | null;
  descriptionModel: ModelHealthStatus | null;
};

function statusLabel(health: string): string {
  return health === "ok" ? "Ready" : health === "disabled" ? "Not configured" : "Unavailable";
}

function statusClassName(health: string): string {
  if (health === "ok") return "admin-dashboard__status--ready";
  if (health === "disabled") return "admin-dashboard__status--disabled";
  return "admin-dashboard__status--unavailable";
}


function applyDashboard(
  response: Awaited<ReturnType<typeof getAdminSyncStatus>>,
  setDashboard: (state: DashboardState) => void
): void {
  setDashboard({
    providers: response.providers,
    embeddingModel: response.embedding_model,
    descriptionModel: response.description_model,
  });
}

const INITIAL_PROVIDERS: ProviderDashboardStatus[] = [
  { provider: "google_drive", display_name: "Google Drive", enabled: true, health: "ok", detected_count: null, embedded_count: null },
  { provider: "dropbox", display_name: "Dropbox", enabled: true, health: "ok", detected_count: null, embedded_count: null },
];

const INITIAL_EMBEDDING_MODEL: ModelHealthStatus = {
  name: "embeddinggemma:latest",
  health: "ok",
};

const INITIAL_DESCRIPTION_MODEL: ModelHealthStatus = {
  name: "deepseek-v4-flash-vision-exp",
  health: "ok",
};

export function AdminPage(): JSX.Element {
  document.title = "Admin Dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const isDashboardPath = typeof window !== "undefined" && (window.location.pathname === "/admin/dashboard" || window.location.pathname === "/admin");
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(isDashboardPath);
  const [dashboard, setDashboard] = useState<DashboardState>({
    providers: INITIAL_PROVIDERS,
    embeddingModel: INITIAL_EMBEDDING_MODEL,
    descriptionModel: INITIAL_DESCRIPTION_MODEL,
  });
  const [refreshingProviders, setRefreshingProviders] = useState<ReadonlySet<string>>(new Set());
  const [syncingProviders, setSyncingProviders] = useState<ReadonlySet<string>>(new Set());
  const [activityByProvider, setActivityByProvider] = useState<Readonly<Record<string, readonly SyncActivityEvent[]>>>({});
  const [openActivityProviders, setOpenActivityProviders] = useState<ReadonlySet<string>>(new Set());
  const [storageFileIds, setStorageFileIds] = useState<Readonly<Record<string, string>>>({});
  const [deletingProviders, setDeletingProviders] = useState<ReadonlySet<string>>(new Set());
  const [itemsByProvider, setItemsByProvider] = useState<Readonly<Record<string, readonly QdrantItem[] | null>>>({});
  const [openItemsProviders, setOpenItemsProviders] = useState<ReadonlySet<string>>(new Set());
  const [loadingItemsProviders, setLoadingItemsProviders] = useState<ReadonlySet<string>>(new Set());
  const [isLoadingDashboard, setIsLoadingDashboard] = useState<boolean>(true);
  const [showAdminMenu, setShowAdminMenu] = useState<boolean>(false);
  const [toasts, setToasts] = useState<readonly { id: string; type: "status" | "error"; message: string; isDismissing?: boolean }[]>([]);

  const addToast = useCallback((message: string, type: "status" | "error") => {
    const id = String(Date.now()) + Math.random().toString(36).slice(2, 6);
    setToasts((prev) => [...prev, { id, type, message }]);

    setTimeout(() => {
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, isDismissing: true } : t)));
    }, 4500);

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4900);
  }, []);

  function setError(message: string | null): void {
    if (message) addToast(message, "error");
  }

  function setDeleteResult(message: string | null): void {
    if (message) addToast(message, "status");
  }

  const controllers = useRef<Record<string, AbortController>>({});

  async function loadDashboard(): Promise<void> {
    setIsLoadingDashboard(true);
    try {
      applyDashboard(await getAdminSyncStatus(), setDashboard);
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  function clearSession(): void {
    setIsAuthenticated(false);
    setDashboard({
      providers: INITIAL_PROVIDERS,
      embeddingModel: INITIAL_EMBEDDING_MODEL,
      descriptionModel: INITIAL_DESCRIPTION_MODEL,
    });
    setSyncingProviders(new Set());
    if (typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
      window.history.replaceState({}, "", "/admin/login");
    }
  }

  async function handleLogout(): Promise<void> {
    setShowAdminMenu(false);
    try {
      await logoutAdmin();
    } catch {
      // Ignore API errors during logout
    } finally {
      clearSession();
    }
  }

  function handleAdminError(caught: unknown, fallback: string, clearOn401 = true): void {
    if (clearOn401 && caught instanceof ApiError && caught.status === 401) {
      clearSession();
      return;
    }
    setError(caught instanceof ApiError ? caught.message : fallback);
  }

  useEffect(() => {
    void (async () => {
      try {
        const account = await getAdminSession();
        setUsername(account.username);
        setIsAuthenticated(true);
        if (window.location.pathname === "/admin" || window.location.pathname === "/admin/login") {
          window.history.replaceState({}, "", "/admin/dashboard");
        }
        await loadDashboard();
      } catch (caught) {
        if (window.location.pathname === "/admin" || window.location.pathname === "/admin/dashboard") {
          window.history.replaceState({}, "", "/admin/login");
        }
        handleAdminError(caught, "Could not restore session");
      }
    })();
    return () => Object.values(controllers.current).forEach((controller) => controller.abort());
  }, []);

  async function submitLogin(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      const account = await loginAdmin(username, password);
      setUsername(account.username);
      setPassword("");
      setIsAuthenticated(true);
      window.history.pushState({}, "", "/admin/dashboard");
      await loadDashboard();
    } catch (caught) {
      handleAdminError(caught, "Could not sign in", false);
    }
  }

  async function refreshProvider(provider: string): Promise<void> {
    setRefreshingProviders((current) => new Set(current).add(provider));
    setError(null);
    try {
      const response = await refreshAdminProvider(provider);
      setDashboard((current) => ({
        ...current,
        providers: current.providers.map((item) => item.provider === provider ? response.provider : item),
        embeddingModel: response.embedding_model,
        descriptionModel: response.description_model,
      }));
    } catch (caught) {
      handleAdminError(caught, "Could not refresh provider");
    } finally {
      setRefreshingProviders((current) => new Set([...current].filter((item) => item !== provider)));
    }
  }

  function toggleActivity(provider: string): void {
    setOpenActivityProviders((current) => {
      const next = new Set(current);
      if (next.has(provider)) {
        next.delete(provider);
      } else {
        next.add(provider);
      }
      return next;
    });
  }

  async function toggleProviderItems(provider: string): Promise<void> {
    if (openItemsProviders.has(provider)) {
      setOpenItemsProviders((current) => new Set([...current].filter((p) => p !== provider)));
      return;
    }
    setLoadingItemsProviders((current) => new Set(current).add(provider));
    setError(null);
    try {
      const response = await getAdminProviderItems(provider);
      setItemsByProvider((current) => ({ ...current, [provider]: response.items }));
      setOpenItemsProviders((current) => new Set(current).add(provider));
    } catch (caught) {
      handleAdminError(caught, "Could not load embedded items");
    } finally {
      setLoadingItemsProviders((current) => new Set([...current].filter((p) => p !== provider)));
    }
  }

  async function deleteEmbeddedItem(provider: string, item: QdrantItem): Promise<void> {
    const itemName = item.filename || item.point_id;
    if (!window.confirm(`Delete embedded Qdrant item "${itemName}"?`)) return;

    setDeletingProviders((current) => new Set(current).add(provider));
    setDeleteResult(null);
    setError(null);
    try {
      await deleteAdminQdrantPoint(item.point_id);
      setItemsByProvider((current) => ({
        ...current,
        [provider]: (current[provider] ?? []).filter((i) => i.point_id !== item.point_id),
      }));
      setDeleteResult(`Deleted embedded item "${itemName}".`);
      await loadDashboard();
    } catch (caught) {
      handleAdminError(caught, "Could not delete embedded item");
    } finally {
      setDeletingProviders((current) => new Set([...current].filter((p) => p !== provider)));
    }
  }

  async function deleteIndexedFile(provider: string, displayName: string): Promise<void> {
    const storageFileId = storageFileIds[provider]?.trim() ?? "";
    if (!storageFileId || !window.confirm(`Delete indexed vectors for ${displayName} file ${storageFileId}? Cloud file stays unchanged.`)) return;

    setDeletingProviders((current) => new Set(current).add(provider));
    setDeleteResult(null);
    setError(null);
    try {
      const response = await reindexAdminStorageFile(provider, storageFileId);
      setStorageFileIds((current) => ({ ...current, [provider]: "" }));
      setDeleteResult(`Deleted ${response.deleted} indexed records.`);
      await loadDashboard();
    } catch (caught) {
      handleAdminError(caught, "Could not delete indexed file");
    } finally {
      setDeletingProviders((current) => new Set([...current].filter((item) => item !== provider)));
    }
  }





  async function syncProvider(provider: string): Promise<void> {
    if (syncingProviders.has(provider)) {
      controllers.current[provider]?.abort();
      void stopAdminSync(provider).catch(() => {});
      return;
    }
    const controller = new AbortController();
    controllers.current = { ...controllers.current, [provider]: controller };
    setSyncingProviders((current) => new Set(current).add(provider));
    setOpenActivityProviders((current) => new Set(current).add(provider));
    setActivityByProvider((current) => ({ ...current, [provider]: [] }));
    setError(null);
    try {
      await streamAdminSync(provider, (event) => {
        if (!event.terminal) {
          setActivityByProvider((current) => {
            const list = current[provider] ?? [];
            const index = event.filename
              ? list.findIndex((item) => item.filename === event.filename)
              : -1;
            const nextList =
              index >= 0
                ? list.map((item, idx) => (idx === index ? event : item))
                : [event, ...list];
            return {
              ...current,
              [provider]: nextList,
            };
          });
        }
      }, controller.signal);
      await loadDashboard();
    } catch (caught) {
      if (!controller.signal.aborted) handleAdminError(caught, safeError);
    } finally {
      setSyncingProviders((current) => new Set([...current].filter((item) => item !== provider)));
      const { [provider]: _, ...rest } = controllers.current;
      controllers.current = rest;
    }
  }

  return (
    <div className="app">
      {/* Floating Island Header */}
      <div className="floating-nav-container">
        <header className="floating-nav-pill">
          <a href="/" className="floating-nav-brand">
            <div className="brand-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#05070c"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "20px", height: "20px" }}
              >
                <path d="M12 2L3 7l9 5 9-5-9-5z" />
                <path d="M3 12l9 5 9-5" />
                <path d="M3 17l9 5 9-5" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Asset Manager</h1>
            </div>
          </a>

          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {isAuthenticated && (
              <div className="admin-menu-wrapper">
                <button
                  type="button"
                  className={`badge admin-menu-btn ${showAdminMenu ? "active" : ""}`}
                  onClick={() => setShowAdminMenu((prev) => !prev)}
                  aria-label="Admin menu"
                  aria-expanded={showAdminMenu}
                >
                  Admin <span style={{ fontSize: "10px", marginLeft: "2px" }}>▾</span>
                </button>

                {showAdminMenu && (
                  <div className="admin-menu-popover" role="menu">
                    {username && (
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", paddingBottom: "6px", borderBottom: "1px solid var(--border)" }}>
                        Signed in as <strong style={{ color: "var(--text)" }}>{username}</strong>
                      </div>
                    )}
                    <button
                      type="button"
                      className="logout-btn"
                      onClick={() => {
                        void handleLogout();
                      }}
                      aria-label="Log out"
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Log out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </header>
      </div>

      <main className="app-content admin-dashboard" style={{ maxWidth: "1140px", margin: "0 auto" }}>
        {!isAuthenticated ? (
          <div className="double-bezel-outer" style={{ maxWidth: "460px", margin: "40px auto 30px" }}>
            <section className="double-bezel-inner">
              <div style={{ marginBottom: "24px", textAlign: "center" }}>
                <div className="eyebrow-badge" style={{ marginBottom: "10px" }}>AUTHENTICATION</div>
                <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 auto", letterSpacing: "-0.02em" }}>
                  Admin Dashboard
                </h2>
                <p style={{ fontSize: "13px", color: "var(--text-dim)", margin: "6px 0 0" }}>
                  Sign in with administrator credentials
                </p>
              </div>

              <form onSubmit={submitLogin}>
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  <div>
                    <label className="field" htmlFor="admin-username">
                      Username
                    </label>
                    <div className="input">
                      <input
                        id="admin-username"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div>
                    <label className="field" htmlFor="admin-password">
                      Password
                    </label>
                    <div className="input">
                      <input
                        id="admin-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                  <div className="actions" style={{ justifyContent: "flex-end", marginTop: "8px" }}>
                    <button className="btn-island-primary" type="submit">
                      <span>Sign in</span>
                      <div className="icon-circle" aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3.5 8.5L8.5 3.5" />
                          <path d="M4 3.5H8.5V8" />
                        </svg>
                      </div>
                    </button>
                  </div>
                </div>
              </form>
            </section>
          </div>
        ) : (
          <>
            <div className="page-header" style={{ marginBottom: "20px" }}>
              <div className="eyebrow-badge" style={{ marginBottom: "8px" }}>METRICS &amp; STORAGE CONTROL</div>
              <h2 style={{ fontSize: "26px", fontWeight: 800, margin: 0, letterSpacing: "-0.03em" }}>
                Admin Dashboard
              </h2>
            </div>

            {/* Quick KPI Statistics Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "28px" }}>
              <div className="double-bezel-outer">
                <div className="double-bezel-inner" style={{ padding: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Storage Sources</div>
                  <div className="mono-font" style={{ fontSize: "28px", fontWeight: 800, color: "#ffffff", marginTop: "4px" }}>
                    {dashboard.providers.length} Connected
                  </div>
                </div>
              </div>

              <div className="double-bezel-outer">
                <div className="double-bezel-inner" style={{ padding: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Overall Coverage</div>
                  <div className="mono-font" style={{ fontSize: "28px", fontWeight: 800, color: "var(--accent)", marginTop: "4px" }}>
                    {(() => {
                      const hasUnloaded = dashboard.providers.some((p) => p.detected_count === null || p.embedded_count === null);
                      if (hasUnloaded) {
                        return <span className="skeleton-box" style={{ display: "inline-block", width: "60px", height: "28px", borderRadius: "6px" }} />;
                      }
                      const det = dashboard.providers.reduce((acc, p) => acc + (p.detected_count ?? 0), 0);
                      const emb = dashboard.providers.reduce((acc, p) => acc + (p.embedded_count ?? 0), 0);
                      return det > 0 ? `${Math.round((emb / det) * 100)}%` : "0%";
                    })()}
                  </div>
                </div>
              </div>

              <div className="double-bezel-outer">
                <div className="double-bezel-inner" style={{ padding: "20px" }}>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.1em" }}>Provider Health</div>
                  <div className="mono-font" style={{ fontSize: "28px", fontWeight: 800, color: "#4ade80", marginTop: "4px" }}>
                    {dashboard.providers.filter((p) => p.health === "ok").length === dashboard.providers.length ? "100% Operational" : "Degraded"}
                  </div>
                </div>
              </div>
            </div>

            {/* High-End Visual Storage Indexing Progress Chart */}
            <div className="double-bezel-outer" style={{ marginBottom: "32px" }}>
              <div className="double-bezel-inner">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
                  <div>
                    <div className="eyebrow-badge" style={{ marginBottom: "6px" }}>ANALYTICS &amp; VISUAL METRICS</div>
                    <h3 style={{ fontSize: "18px", fontWeight: 700, margin: 0 }}>Storage Vector Indexing Progress</h3>
                  </div>
                  <div className="mono-font" style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                    REAL-TIME SYNC RATIO
                  </div>
                </div>

                <div style={{ display: "grid", gap: "16px" }}>
                  {dashboard.providers.map((provider) => {
                    const isLoaded = provider.detected_count !== null && provider.detected_count !== undefined && provider.embedded_count !== null && provider.embedded_count !== undefined;
                    const det = provider.detected_count ?? 0;
                    const emb = provider.embedded_count ?? 0;
                    const pct = isLoaded && det > 0 ? Math.min(100, Math.round((emb / det) * 100)) : 0;
                    const isComplete = isLoaded && det > 0 && pct === 100;
                    return (
                      <div key={provider.provider} style={{ background: "rgba(0,0,0,0.3)", padding: "16px 20px", borderRadius: "14px", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontWeight: 700, fontSize: "14px", color: "#ffffff" }}>{provider.display_name}</span>
                            <span className="mono-font" style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                              {isLoaded ? `(${emb} / ${det} files)` : "(Loading files…)"}
                            </span>
                          </div>
                          <span className="mono-font" style={{ fontSize: "13px", fontWeight: 700, color: isComplete ? "#4ade80" : "var(--accent)" }}>
                            {isLoaded ? (
                              `${pct}% Indexed`
                            ) : (
                              <span className="skeleton-box" style={{ display: "inline-flex", alignItems: "center", fontSize: "12px", fontWeight: 500, padding: "2px 8px", borderRadius: "6px", color: "var(--text-muted)" }}>
                                Loading…
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Visual Gradient Progress Bar */}
                        <div style={{ width: "100%", height: "8px", background: "rgba(255,255,255,0.08)", borderRadius: "999px", overflow: "hidden" }}>
                          <div
                            style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: isComplete ? "linear-gradient(90deg, #4ade80, #22c55e)" : "linear-gradient(90deg, #a78bff, #5fa8ff)",
                              borderRadius: "999px",
                              boxShadow: isComplete ? "0 0 12px rgba(74,222,128,0.5)" : "0 0 12px rgba(167,139,255,0.5)",
                              transition: "width 0.8s cubic-bezier(0.32, 0.72, 0, 1)",
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="admin-dashboard__controls" style={{ marginBottom: "16px" }}>
              <div>
                <h2 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 4px 0" }}>
                  Storage providers
                </h2>
              </div>
            </div>

            <section className="admin-dashboard__providers" aria-label="Storage providers">
              {dashboard.providers.map((provider) => {
                const isRefreshing = refreshingProviders.has(provider.provider);
                const isSyncing = syncingProviders.has(provider.provider);
                const events = activityByProvider[provider.provider] ?? [];
                const storageFileId = storageFileIds[provider.provider] ?? "";
                const isDeleting = deletingProviders.has(provider.provider);
                const items = itemsByProvider[provider.provider];
                const isOpenItems = openItemsProviders.has(provider.provider);
                const isLoadingItems = loadingItemsProviders.has(provider.provider);
                return (
                  <article className="admin-dashboard__provider double-bezel-outer" key={provider.provider}>
                    <div className="double-bezel-inner">
                      <div className="admin-dashboard__card-head">
                        <h2 style={{ fontSize: "20px", fontWeight: 700 }}>{provider.display_name}</h2>
                        <span className={`admin-dashboard__status ${statusClassName(provider.health)}`}>
                          {statusLabel(provider.health)}
                        </span>
                      </div>
                      <dl className="admin-dashboard__metrics">
                        <div>
                          <dt>Detected</dt>
                          <dd className="mono-font">
                            {provider.detected_count !== null && provider.detected_count !== undefined ? (
                              provider.detected_count
                            ) : (
                              <span className="skeleton-box" style={{ display: "inline-flex", alignItems: "center", fontSize: "13px", fontWeight: 500, padding: "2px 8px", borderRadius: "6px", color: "var(--text-muted)" }}>
                                Loading…
                              </span>
                            )}
                          </dd>
                        </div>
                        <div className="admin-dashboard__embedded">
                          <dt>Embedded</dt>
                          <dd className="mono-font">
                            {provider.embedded_count !== null && provider.embedded_count !== undefined ? (
                              provider.embedded_count
                            ) : (
                              <span className="skeleton-box" style={{ display: "inline-flex", alignItems: "center", fontSize: "13px", fontWeight: 500, padding: "2px 8px", borderRadius: "6px", color: "var(--text-muted)" }}>
                                Loading…
                              </span>
                            )}
                          </dd>
                        </div>
                      </dl>
                      <div className="admin-dashboard__actions">
                        <button
                          type="button"
                          onClick={() => void refreshProvider(provider.provider)}
                          disabled={isRefreshing}
                          aria-label={`${isRefreshing ? "Refreshing" : "Refresh"} ${provider.display_name}`}
                        >
                          {isRefreshing ? "Refreshing…" : "Refresh"}
                        </button>
                        <button
                          className={`admin-dashboard__sync ${isSyncing ? "admin-dashboard__sync--stopping" : ""}`}
                          type="button"
                          onClick={() => void syncProvider(provider.provider)}
                          disabled={!provider.enabled && !isSyncing}
                          aria-label={`${isSyncing ? "Stop syncing" : "Sync"} ${provider.display_name}`}
                        >
                          {isSyncing ? "Stop syncing" : "Sync"}
                        </button>
                      </div>
                      <div className="admin-dashboard__delete">
                        <label htmlFor={`storage-file-id-${provider.provider}`}>
                          {provider.display_name} storage file ID
                        </label>
                        <div>
                          <input
                            id={`storage-file-id-${provider.provider}`}
                            value={storageFileId}
                            onChange={(event) =>
                              setStorageFileIds((current) => ({
                                ...current,
                                [provider.provider]: event.target.value,
                              }))
                            }
                            placeholder="Storage file ID"
                            className="mono-font"
                          />
                          <button
                            type="button"
                            className="admin-dashboard__delete-button"
                            onClick={() => void deleteIndexedFile(provider.provider, provider.display_name)}
                            disabled={!provider.enabled || !storageFileId.trim() || isDeleting}
                            aria-label={`Delete indexed file ${provider.display_name}`}
                          >
                            {isDeleting ? "Deleting…" : "Delete indexed file"}
                          </button>
                        </div>
                      </div>
                      <div className="admin-dashboard__items-section">
                        <button
                          type="button"
                          className="admin-dashboard__toggle-items"
                          onClick={() => void toggleProviderItems(provider.provider)}
                          disabled={isLoadingItems || !provider.enabled}
                          aria-label={`View embedded items for ${provider.display_name}`}
                        >
                          {isLoadingItems
                            ? "Loading items…"
                            : isOpenItems
                            ? "Hide embedded items"
                            : `View embedded items (${provider.embedded_count ?? 0})`}
                        </button>
                        {isOpenItems && items && items.length > 0 ? (
                          <ul
                            className="admin-dashboard__items-list"
                            aria-label={`Embedded items for ${provider.display_name}`}
                          >
                            {items.map((item) => (
                              <li key={item.point_id} className="admin-dashboard__item-row">
                                <div className="admin-dashboard__item-info">
                                  <span
                                    className="admin-dashboard__item-name"
                                    title={item.filename || item.point_id}
                                  >
                                    {item.filename || item.point_id}
                                  </span>
                                  <small className="admin-dashboard__item-meta mono-font">
                                    {item.file_type ? `${item.file_type} · ` : ""}ID:{" "}
                                    {item.point_id.slice(0, 8)}…
                                  </small>
                                </div>
                                <button
                                  type="button"
                                  className="admin-dashboard__delete-button"
                                  onClick={() => void deleteEmbeddedItem(provider.provider, item)}
                                  aria-label={`Delete ${item.filename || item.point_id}`}
                                >
                                  Delete
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : isOpenItems && items ? (
                          <p className="admin-dashboard__empty-items">No embedded items found.</p>
                        ) : null}
                      </div>
                      {openActivityProviders.has(provider.provider) ? (
                        <section
                          className="admin-dashboard__activity"
                          aria-label={`${provider.display_name} sync activity`}
                          aria-live="polite"
                        >
                          <div>
                            <span>
                              Sync activity <small style={{ color: "var(--text-muted)", marginLeft: "4px" }}>({events.length} events)</small>
                            </span>
                            <button
                              type="button"
                              className="admin-dashboard__close-activity"
                              onClick={() => toggleActivity(provider.provider)}
                              aria-label={`Close ${provider.display_name} sync activity`}
                            >
                              Close activity ✕
                            </button>
                          </div>
                          <ul className="admin-dashboard__activity-list">
                            {events.map((event) => (
                              <li key={event.sequence}>
                                <span
                                  className={`admin-dashboard__activity-icon admin-dashboard__activity-icon--${event.status}`}
                                  aria-hidden="true"
                                />
                                <span className="mono-font">{event.filename ?? event.detail}</span>
                                <small>{event.status}</small>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ) : events.length > 0 ? (
                        <div className="admin-dashboard__items-section" style={{ borderTop: "1px solid var(--border)" }}>
                          <button
                            type="button"
                            className="admin-dashboard__toggle-items"
                            onClick={() => toggleActivity(provider.provider)}
                            aria-label={`View sync activity for ${provider.display_name}`}
                          >
                            View sync activity ({events.length})
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>

            <section className="admin-dashboard__models" aria-labelledby="model-health" style={{ marginTop: "40px" }}>
              <div className="eyebrow-badge" style={{ marginBottom: "8px" }}>INFERENCE INFRASTRUCTURE</div>
              <h2 id="model-health" style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 16px 0" }}>
                Model health
              </h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "20px" }}>
                {[
                  ["Embedding model", dashboard.embeddingModel],
                  ["Description model", dashboard.descriptionModel],
                ].map(
                  ([role, model]) =>
                    model && (
                      <article key={role as string} className="double-bezel-outer">
                        <div className="double-bezel-inner">
                          <p style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 6px" }}>{role as string}</p>
                          <strong className="mono-font" style={{ fontSize: "16px", color: "#ffffff", display: "block", marginBottom: "12px" }}>{(model as ModelHealthStatus).name}</strong>
                          <span
                            className={`admin-dashboard__status ${statusClassName(
                              (model as ModelHealthStatus).health
                            )}`}
                          >
                            {statusLabel((model as ModelHealthStatus).health)}
                          </span>
                        </div>
                      </article>
                    )
                )}
              </div>
            </section>
          </>
        )}
        <div className="toast-container" aria-live="polite">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`banner ${toast.type === "status" ? "banner--status" : ""} ${toast.isDismissing ? "banner--dismissing" : ""}`}
              role={toast.type === "status" ? "status" : "alert"}
            >
              {toast.message}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
