import { useEffect, useMemo, useRef, useState } from "react";
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
  const [wavingIds, setWavingIds] = useState<ReadonlySet<string>>(new Set());
  const [enteringIds, setEnteringIds] = useState<ReadonlySet<string>>(new Set());
  const prevStatusesRef = useRef<Map<string, AdminSyncJobActivity["status"]>>(new Map());
  const knownIdsRef = useRef<ReadonlySet<string>>(new Set());

  const providerActivity = useMemo(
    () => providers.flatMap((provider) => {
      const activity = activityByProvider[provider.provider] ?? [];
      return activity.length > 0
        ? [{ provider, activity: [...activity].sort((left, right) => right.sequence - left.sequence) }]
        : [];
    }),
    [providers, activityByProvider],
  );

  const visibleIds = useMemo(
    () => new Set(
      providerActivity.flatMap(({ provider, activity }) =>
        activity.map((event) => `${provider.provider}-${event.storage_file_id}`),
      ),
    ),
    [providerActivity],
  );

  useEffect(() => {
    const newlyVisibleIds = [...visibleIds].filter(
      (id) => !knownIdsRef.current.has(id),
    );
    knownIdsRef.current = visibleIds;

    if (newlyVisibleIds.length > 0) {
      setEnteringIds((current) => new Set([...current, ...newlyVisibleIds]));
    }
  }, [visibleIds]);

  useEffect(() => {
    if (enteringIds.size === 0) return;

    const timer = window.setTimeout(() => {
      setEnteringIds(new Set());
    }, 360);

    return () => {
      window.clearTimeout(timer);
    };
  }, [enteringIds]);


  useEffect(() => {
    const currentStatuses = new Map<string, AdminSyncJobActivity["status"]>();
    const newlyIndexed: string[] = [];

    for (const { provider, activity } of providerActivity) {
      for (const event of activity) {
        const key = `${provider.provider}-${event.storage_file_id}`;
        currentStatuses.set(key, event.status);

        const prevStatus = prevStatusesRef.current.get(key);
        if (event.status === "indexed" && prevStatus && prevStatus !== "indexed") {
          newlyIndexed.push(key);
        }
      }
    }

    prevStatusesRef.current = currentStatuses;

    if (newlyIndexed.length > 0) {
      setWavingIds((prev) => {
        const next = new Set(prev);
        for (const id of newlyIndexed) next.add(id);
        return next;
      });

      const timer = window.setTimeout(() => {
        setWavingIds((prev) => {
          const next = new Set(prev);
          for (const id of newlyIndexed) next.delete(id);
          return next;
        });
      }, 1800);

      return () => {
        window.clearTimeout(timer);
      };
    }
  }, [providerActivity]);

  return (
    <section className="admin-sync-activity" aria-label="Sync activity" aria-live="polite" aria-atomic="false">
      <header className="admin-sync-activity__header">
        <div><h2>Sync activity</h2></div>
      </header>
      <div className="admin-sync-activity__groups">
        {providerActivity.length === 0 ? <p>No ingestion activity yet.</p> : providerActivity.flatMap(({ provider, activity }) => activity.map((event) => {
          const providerClass = providerClassName(provider.provider);
          const cardKey = `${provider.provider}-${event.storage_file_id}`;
          const isWaving = wavingIds.has(cardKey);
          const isEntering = enteringIds.has(cardKey);

          const cardClassName = [
            "admin-sync-file-card",
            isEntering ? "admin-sync-file-card--entering" : "",
            `admin-sync-file-card--${providerClass}`,
            `admin-sync-file-card--${event.status}`,
            isActive(event.status) ? `admin-sync-file-card--active-${event.status}` : "",
            isWaving ? "admin-sync-file-card--wave-circle" : "",
          ].filter(Boolean).join(" ");

          return (
            <article
              className={cardClassName}
              key={cardKey}
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
