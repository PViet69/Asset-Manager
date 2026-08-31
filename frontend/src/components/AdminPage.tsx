import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  ApiError,
  deleteAdminQdrantPoint,
  getAdminProviderItems,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
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
  const [storageFileIds, setStorageFileIds] = useState<Readonly<Record<string, string>>>({});
  const [deletingProviders, setDeletingProviders] = useState<ReadonlySet<string>>(new Set());
  const [itemsByProvider, setItemsByProvider] = useState<Readonly<Record<string, readonly QdrantItem[] | null>>>({});
  const [openItemsProviders, setOpenItemsProviders] = useState<ReadonlySet<string>>(new Set());
  const [loadingItemsProviders, setLoadingItemsProviders] = useState<ReadonlySet<string>>(new Set());
  const [deleteResult, setDeleteResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          return <article className="admin-dashboard__provider" key={provider.provider}>
            <div className="admin-dashboard__card-head"><h2>{provider.display_name}</h2><span className={`admin-dashboard__status ${statusClassName(provider.health)}`}>{statusLabel(provider.health)}</span></div>
            <dl className="admin-dashboard__metrics"><div><dt>Detected</dt><dd>{provider.detected_count ?? "—"}</dd></div><div className="admin-dashboard__embedded"><dt>Embedded</dt><dd>{provider.embedded_count ?? "—"}</dd></div></dl>
            <div className="admin-dashboard__actions"><button type="button" onClick={() => void refreshProvider(provider.provider)} disabled={isRefreshing} aria-label={`${isRefreshing ? "Refreshing" : "Refresh"} ${provider.display_name}`}>{isRefreshing ? "Refreshing…" : "Refresh"}</button><button className={`admin-dashboard__sync ${isSyncing ? "admin-dashboard__sync--stopping" : ""}`} type="button" onClick={() => void syncProvider(provider.provider)} disabled={!provider.enabled && !isSyncing} aria-label={`${isSyncing ? "Stop syncing" : "Sync"} ${provider.display_name}`}>{isSyncing ? "Stop syncing" : "Sync"}</button></div>
            <div className="admin-dashboard__delete"><label htmlFor={`storage-file-id-${provider.provider}`}>{provider.display_name} storage file ID</label><div><input id={`storage-file-id-${provider.provider}`} value={storageFileId} onChange={(event) => setStorageFileIds((current) => ({ ...current, [provider.provider]: event.target.value }))} placeholder="Storage file ID" /><button type="button" className="admin-dashboard__delete-button" onClick={() => void deleteIndexedFile(provider.provider, provider.display_name)} disabled={!provider.enabled || !storageFileId.trim() || isDeleting} aria-label={`Delete indexed file ${provider.display_name}`}>{isDeleting ? "Deleting…" : "Delete indexed file"}</button></div></div>
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
                <ul className="admin-dashboard__items-list" aria-label={`Embedded items for ${provider.display_name}`}>
                  {items.map((item) => (
                    <li key={item.point_id} className="admin-dashboard__item-row">
                      <div className="admin-dashboard__item-info">
                        <span className="admin-dashboard__item-name" title={item.filename || item.point_id}>
                          {item.filename || item.point_id}
                        </span>
                        <small className="admin-dashboard__item-meta">
                          {item.file_type ? `${item.file_type} · ` : ""}ID: {item.point_id.slice(0, 8)}…
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
            {openActivityProviders.has(provider.provider) ? <section className="admin-dashboard__activity" aria-label={`${provider.display_name} sync activity`} aria-live="polite"><div>Sync activity <span>{events.length} events</span></div><ul className="admin-dashboard__activity-list">{events.map((event) => <li key={event.sequence}><span className={`admin-dashboard__activity-icon admin-dashboard__activity-icon--${event.status}`} aria-hidden="true" /><span>{event.filename ?? event.detail}</span><small>{event.status}</small></li>)}</ul></section> : null}
          </article>;
        })}

      </section>

      <section className="admin-dashboard__models" aria-labelledby="model-health"><h2 id="model-health">Model health</h2><div>{[["Embedding model", dashboard.embeddingModel], ["Description model", dashboard.descriptionModel]].map(([role, model]) => model && <article key={role as string}><p>{role as string}</p><strong>{(model as ModelHealthStatus).name}</strong><span className={`admin-dashboard__status ${statusClassName((model as ModelHealthStatus).health)}`}>{statusLabel((model as ModelHealthStatus).health)}</span></article>)}</div></section>



    </>}
    {deleteResult ? <p className="banner" role="status">{deleteResult}</p> : null}
    {error ? <p className="banner" role="alert">{error}</p> : null}
  </main>;
}
