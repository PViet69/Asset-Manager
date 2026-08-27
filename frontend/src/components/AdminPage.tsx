import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
  refreshAdminProvider,
  stopAdminSync,
  streamAdminSync,
} from "../api/client";
import type {
  ModelHealthStatus,
  ProviderDashboardStatus,
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

type ProviderSortOption =
  | "name_asc"
  | "name_desc"
  | "detected_desc"
  | "detected_asc"
  | "embedded_desc"
  | "embedded_asc"
  | "health";

function sortProviders(
  providers: readonly ProviderDashboardStatus[],
  sortBy: ProviderSortOption
): ProviderDashboardStatus[] {
  return [...providers].sort((a, b) => {
    switch (sortBy) {
      case "name_asc":
        return a.display_name.localeCompare(b.display_name);
      case "name_desc":
        return b.display_name.localeCompare(a.display_name);
      case "detected_desc":
        return (b.detected_count ?? -1) - (a.detected_count ?? -1);
      case "detected_asc":
        return (a.detected_count ?? Infinity) - (b.detected_count ?? Infinity);
      case "embedded_desc":
        return (b.embedded_count ?? -1) - (a.embedded_count ?? -1);
      case "embedded_asc":
        return (a.embedded_count ?? Infinity) - (b.embedded_count ?? Infinity);
      case "health": {
        const rank = (health: string) => (health === "ok" ? 0 : health === "unavailable" ? 1 : 2);
        return rank(a.health) - rank(b.health);
      }
      default:
        return 0;
    }
  });
}

export function AdminPage(): JSX.Element {
  document.title = "Admin Dashboard";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [dashboard, setDashboard] = useState<DashboardState>({ providers: [], embeddingModel: null, descriptionModel: null });
  const [refreshingProviders, setRefreshingProviders] = useState<ReadonlySet<string>>(new Set());
  const [syncingProviders, setSyncingProviders] = useState<ReadonlySet<string>>(new Set());
  const [activityByProvider, setActivityByProvider] = useState<Readonly<Record<string, readonly SyncActivityEvent[]>>>({});
  const [openActivityProviders, setOpenActivityProviders] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<ProviderSortOption>("name_asc");
  const controllers = useRef<Record<string, AbortController>>({});

  async function loadDashboard(): Promise<void> {
    applyDashboard(await getAdminSyncStatus(), setDashboard);
  }

  function clearSession(): void {
    setIsAuthenticated(false);
    setDashboard({ providers: [], embeddingModel: null, descriptionModel: null });
    setSyncingProviders(new Set());
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
        await loadDashboard();
      } catch (caught) {
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

  return <main className="app admin-dashboard">
    <header className="admin-dashboard__header"><p className="admin-dashboard__brand">Asset Tracker</p><span>Admin</span></header>
    {!isAuthenticated ? <form className="glass panel-card" onSubmit={submitLogin}>
      <label className="field" htmlFor="admin-username">Username</label><div className="input"><input id="admin-username" value={username} onChange={(event) => setUsername(event.target.value)} required /></div>
      <label className="field" htmlFor="admin-password">Password</label><div className="input"><input id="admin-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
      <div className="actions"><button className="primary" type="submit">Sign in</button></div>
    </form> : <>
      <div className="admin-dashboard__controls">
        <div>
          <h1>Storage providers</h1>
          <p className="admin-dashboard__subtitle">Detected files and embedded records.</p>
        </div>
        <div className="admin-dashboard__sort">
          <label htmlFor="provider-sort">Sort by</label>
          <select
            id="provider-sort"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as ProviderSortOption)}
          >
            <option value="name_asc">Name (A–Z)</option>
            <option value="name_desc">Name (Z–A)</option>
            <option value="detected_desc">Detected (High → Low)</option>
            <option value="detected_asc">Detected (Low → High)</option>
            <option value="embedded_desc">Embedded (High → Low)</option>
            <option value="embedded_asc">Embedded (Low → High)</option>
            <option value="health">Health status</option>
          </select>
        </div>
      </div>
      <section className="admin-dashboard__providers" aria-label="Storage providers">
        {sortProviders(dashboard.providers, sortBy).map((provider) => {
          const isRefreshing = refreshingProviders.has(provider.provider);
          const isSyncing = syncingProviders.has(provider.provider);
          const events = activityByProvider[provider.provider] ?? [];
          return <article className="admin-dashboard__provider" key={provider.provider}>
            <div className="admin-dashboard__card-head"><h2>{provider.display_name}</h2><span className={`admin-dashboard__status ${provider.health === "ok" ? "" : "admin-dashboard__status--warning"}`}>{statusLabel(provider.health)}</span></div>
            <dl className="admin-dashboard__metrics"><div><dt>Detected</dt><dd>{provider.detected_count ?? "—"}</dd></div><div className="admin-dashboard__embedded"><dt>Embedded</dt><dd>{provider.embedded_count ?? "—"}</dd></div></dl>
            <div className="admin-dashboard__actions"><button type="button" onClick={() => void refreshProvider(provider.provider)} disabled={isRefreshing} aria-label={`${isRefreshing ? "Refreshing" : "Refresh"} ${provider.display_name}`}>{isRefreshing ? "Refreshing…" : "Refresh"}</button><button className={`admin-dashboard__sync ${isSyncing ? "admin-dashboard__sync--stopping" : ""}`} type="button" onClick={() => void syncProvider(provider.provider)} disabled={!provider.enabled && !isSyncing} aria-label={`${isSyncing ? "Stop syncing" : "Sync"} ${provider.display_name}`}>{isSyncing ? "Stop syncing" : "Sync"}</button></div>
            {openActivityProviders.has(provider.provider) ? <section className="admin-dashboard__activity" aria-label={`${provider.display_name} sync activity`} aria-live="polite"><div>Sync activity <span>{events.length} events</span></div><ul className="admin-dashboard__activity-list">{events.map((event) => <li key={event.sequence}><span className={`admin-dashboard__activity-icon admin-dashboard__activity-icon--${event.status}`} aria-hidden="true" /><span>{event.filename ?? event.detail}</span><small>{event.status}</small></li>)}</ul></section> : null}
          </article>;
        })}
      </section>
      <section className="admin-dashboard__models" aria-labelledby="model-health"><h2 id="model-health">Model health</h2><div>{[["Embedding model", dashboard.embeddingModel], ["Description model", dashboard.descriptionModel]].map(([role, model]) => model && <article key={role as string}><p>{role as string}</p><strong>{(model as ModelHealthStatus).name}</strong><span className="admin-dashboard__status">{statusLabel((model as ModelHealthStatus).health)}</span></article>)}</div></section>
    </>}
    {error ? <p className="banner" role="alert">{error}</p> : null}
  </main>;
}
