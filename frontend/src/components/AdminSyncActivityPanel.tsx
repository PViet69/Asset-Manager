import type {
  ProviderDashboardStatus,
  SyncActivityEvent,
} from "../types";
import { ProviderLogo } from "./ProviderLogo";

export interface AdminSyncActivityPanelProps {
  readonly providers: readonly ProviderDashboardStatus[];
  readonly activityByProvider: Readonly<Record<string, readonly SyncActivityEvent[]>>;
}

function eventLabel(status: SyncActivityEvent["status"]): string {
  if (status === "indexing") return "Indexing";
  if (status === "indexed") return "Indexed";
  if (status === "failed") return "Failed";
  if (status === "stopped") return "Stopped";
  return "Preparing";
}

function providerClassName(provider: string): string {
  const normalizedProvider = provider.toLowerCase().replace(/[\s_]+/g, "-");

  if (["google-drive", "googledrive", "gdrive"].includes(normalizedProvider)) {
    return "google-drive";
  }

  if (normalizedProvider === "dropbox") return "dropbox";

  return "unknown";
}

function isActive(status: SyncActivityEvent["status"]): boolean {
  return status === "preparing" || status === "indexing";
}

export function AdminSyncActivityPanel({
  providers,
  activityByProvider,
}: AdminSyncActivityPanelProps): JSX.Element | null {
  const providerActivity = providers
    .map((provider) => ({ provider, events: activityByProvider[provider.provider] ?? [] }))
    .filter(({ events }) => events.length > 0);

  return (
    <section className="admin-sync-activity" aria-label="Sync activity" aria-live="polite" aria-atomic="false">
      <header className="admin-sync-activity__header">
        <div>
          <h2>Sync activity</h2>
        </div>
      </header>
      <div className="admin-sync-activity__groups">
        {providerActivity.flatMap(({ provider, events }) => events.map((event) => {
          const filename = event.filename ?? "Provider sync";
          const providerClass = providerClassName(provider.provider);
          const cardClassName = [
            "admin-sync-file-card",
            "admin-sync-file-card--entering",
            `admin-sync-file-card--${providerClass}`,
            `admin-sync-file-card--${event.status}`,
            isActive(event.status) ? "admin-sync-file-card--active" : "",
          ].filter(Boolean).join(" ");

          return (
            <article className={cardClassName} key={event.sequence} aria-label={`${provider.display_name} ${filename}`}>
              <strong className="admin-sync-file-card__filename" title={filename}>{filename}</strong>
              <div className="admin-sync-file-card__meta">
                <span className="admin-sync-file-card__provider">
                  <ProviderLogo provider={provider.provider} size={16} aria-hidden="true" />
                  {provider.display_name}
                </span>
                <span className="admin-sync-file-card__status">{eventLabel(event.status)}</span>
              </div>
            </article>
          );
        }))}
      </div>
    </section>
  );
}
