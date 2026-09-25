import type { AdminSyncJobActivity, ProviderDashboardStatus } from "../types";
import { ProviderLogo } from "./ProviderLogo";

export interface AdminSyncActivityPanelProps {
  readonly providers: readonly ProviderDashboardStatus[];
  readonly activityByProvider: Readonly<Record<string, readonly AdminSyncJobActivity[]>>;
}

function statusLabel(status: AdminSyncJobActivity["status"]): string {
  const labels: Readonly<Record<AdminSyncJobActivity["status"], string>> = {
    preparing: "Preparing",
    indexing: "Indexing",
    indexed: "Indexed",
    failed: "Failed",
    stopped: "Stopped",
  };
  return labels[status];
}

function providerClassName(provider: string): string {
  const normalized = provider.toLowerCase().replace(/[\s_]+/g, "-");
  if (["google-drive", "googledrive", "gdrive"].includes(normalized)) {
    return "google-drive";
  }
  if (normalized === "dropbox") return "dropbox";
  return normalized;
}

function isActive(status: AdminSyncJobActivity["status"]): boolean {
  return status === "preparing" || status === "indexing";
}

export function AdminSyncActivityPanel({
  providers,
  activityByProvider,
}: AdminSyncActivityPanelProps): JSX.Element {
  const providerActivity = providers.flatMap((provider) => {
    const activity = activityByProvider[provider.provider] ?? [];
    return activity.length > 0 ? [{ provider, activity: [...activity].sort((left, right) => right.sequence - left.sequence) }] : [];
  });

  return (
    <section className="admin-sync-activity" aria-label="Sync activity" aria-live="polite" aria-atomic="false">
      <header className="admin-sync-activity__header">
        <div><h2>Sync activity</h2></div>
      </header>
      <div className="admin-sync-activity__groups">
        {providerActivity.length === 0 ? <p>No ingestion activity yet.</p> : providerActivity.flatMap(({ provider, activity }) => activity.map((event) => {
          const providerClass = providerClassName(provider.provider);
          const cardClassName = [
            "admin-sync-file-card",
            "admin-sync-file-card--entering",
            `admin-sync-file-card--${providerClass}`,
            `admin-sync-file-card--${event.status}`,
            isActive(event.status) ? "admin-sync-file-card--active" : "",
          ].filter(Boolean).join(" ");

          return (
            <article
              className={cardClassName}
              key={`${provider.provider}-${event.storage_file_id}`}
              aria-label={`${event.filename}: ${statusLabel(event.status)}`}
            >
              <strong className="admin-sync-file-card__filename">{event.filename}</strong>
              <div className="admin-sync-file-card__meta">
                <span className="admin-sync-file-card__provider">
                  <ProviderLogo provider={provider.provider} size={16} aria-hidden="true" />
                  {provider.display_name}
                </span>
                <span className="admin-sync-file-card__status">{statusLabel(event.status)}</span>
              </div>
            </article>
          );
        }))}
      </div>
    </section>
  );
}
