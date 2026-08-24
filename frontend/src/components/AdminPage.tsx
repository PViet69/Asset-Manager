import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError, getAdminSyncStatus, triggerAdminSync } from "../api/client";
import type { ProviderSyncStatus } from "../types";

export function AdminPage(): JSX.Element {
  const [adminApiKey, setAdminApiKey] = useState("");
  const [activeKey, setActiveKey] = useState("");
  const [providers, setProviders] = useState<ProviderSyncStatus[]>([]);
  const [syncingProvider, setSyncingProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadProviders(key: string): Promise<void> {
    const response = await getAdminSyncStatus(key);
    setProviders(response.providers);
  }

  async function submitKey(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    try {
      await loadProviders(adminApiKey);
      setActiveKey(adminApiKey);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Could not load providers");
    }
  }

  async function syncProvider(provider: string): Promise<void> {
    setSyncingProvider(provider);
    setError(null);
    try {
      await triggerAdminSync(provider, activeKey);
      await loadProviders(activeKey);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Sync failed");
    } finally {
      setSyncingProvider(null);
    }
  }

  return (
    <main className="app">
      <header className="bar">
        <div className="brand">
          <div>
            <h1>Storage sync</h1>
            <div className="sub">Manual provider controls</div>
          </div>
        </div>
      </header>
      {!activeKey ? (
        <form className="glass panel-card" onSubmit={submitKey}>
          <label className="field" htmlFor="admin-api-key">Admin API key</label>
          <div className="input"><input id="admin-api-key" type="password" value={adminApiKey} onChange={(event) => setAdminApiKey(event.target.value)} required /></div>
          <div className="actions"><span className="meta">Kept only until this page reloads.</span><button className="primary" type="submit">Load providers</button></div>
        </form>
      ) : (
        <section className="admin-grid" aria-label="Storage providers">
          {providers.map((provider) => (
            <article className="glass panel-card" key={provider.provider}>
              <div className="row-line"><h2>{provider.display_name}</h2><span className="badge stored">{provider.health}</span></div>
              <p className="meta">{provider.enabled ? "Configured" : "Not configured"}</p>
              <p className="meta">Upserted: {provider.last_upserted ?? 0} · Deleted: {provider.last_deleted ?? 0} · Failed: {provider.last_failed ?? 0}</p>
              <button className="primary" type="button" disabled={!provider.enabled || syncingProvider === provider.provider} onClick={() => syncProvider(provider.provider)}>
                {syncingProvider === provider.provider ? "Syncing…" : `Sync ${provider.display_name}`}
              </button>
              {provider.last_traces.map((trace) => <p className="meta" key={`${trace.timestamp}-${trace.step}`}>{trace.detail}</p>)}
            </article>
          ))}
        </section>
      )}
      {error ? <p className="banner" role="alert">{error}</p> : null}
    </main>
  );
}
