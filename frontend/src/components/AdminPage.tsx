import { useState } from "react";
import type { FormEvent } from "react";

import { ApiError, getAdminSyncStatus, triggerAdminSync } from "../api/client";
import type { ProviderSyncStatus } from "../types";

function providerHealthLabel(provider: ProviderSyncStatus): string {
  return provider.enabled && provider.health === "ok" ? "Connected" : "Unavailable";
}

function traceSummary(count: number): string {
  return `${count} activity ${count === 1 ? "event" : "events"}`;
}

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
            <article className="glass provider-card" key={provider.provider}>
              <div className="provider-card__header">
                <div>
                  <h2>{provider.display_name}</h2>
                  <p className="provider-card__status">
                    {provider.enabled ? "Configured" : "Not configured"}
                  </p>
                </div>
                <span className={`badge ${provider.enabled && provider.health === "ok" ? "stored" : "error"}`}>
                  {providerHealthLabel(provider)}
                </span>
              </div>
              <dl className="provider-card__metrics">
                <div><dt>Indexed</dt><dd>{provider.last_upserted ?? 0}</dd></div>
                <div><dt>Deleted</dt><dd>{provider.last_deleted ?? 0}</dd></div>
                <div><dt>Failed</dt><dd>{provider.last_failed ?? 0}</dd></div>
              </dl>
              <div className="provider-card__footer">
                <span className="provider-card__summary">Last sync result</span>
                <button className="provider-card__sync" type="button" disabled={!provider.enabled || syncingProvider === provider.provider} onClick={() => syncProvider(provider.provider)}>
                  {syncingProvider === provider.provider ? "Syncing…" : "Sync now"}
                </button>
              </div>
              {provider.last_traces.length > 0 ? (
                <details className="provider-card__activity">
                  <summary><span>View activity</span><span>{traceSummary(provider.last_traces.length)}</span></summary>
                  <ul>
                    {provider.last_traces.map((trace) => (
                      <li key={`${trace.timestamp}-${trace.step}-${trace.storage_file_id ?? ""}`}>
                        <span aria-hidden="true">{trace.status === "failed" ? "!" : "✓"}</span>
                        <span>{trace.detail}</span>
                        {trace.filename ? <span className="provider-card__filename">{trace.filename}</span> : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </article>
          ))}
        </section>
      )}
      {error ? <p className="banner" role="alert">{error}</p> : null}
    </main>
  );
}
