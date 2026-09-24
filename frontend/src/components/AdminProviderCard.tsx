import { useEffect, useState } from "react";
import type { ProviderDashboardStatus } from "../types";
import { ProviderLogo } from "./ProviderLogo";

export interface AdminProviderCardProps {
  readonly provider: ProviderDashboardStatus;
  readonly isRefreshing: boolean;
  readonly isSyncing: boolean;
  readonly isItemsLoading: boolean;
  readonly onRefresh: (provider: string) => void;
  readonly onOpenItems: (provider: string) => void;
  readonly onSync: (provider: string) => void;
}

function healthLabel(health: string): string {
  if (health === "ok") return "Ready";
  if (health === "disabled") return "Not configured";
  return "Unavailable";
}

function healthClassName(health: string): string {
  if (health === "ok") return "admin-status--ready";
  if (health === "disabled") return "admin-status--disabled";
  return "admin-status--unavailable";
}

export function AdminProviderCard({
  provider,
  isRefreshing,
  isSyncing,
  isItemsLoading,
  onRefresh,
  onOpenItems,
  onSync,
}: AdminProviderCardProps): JSX.Element {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const detectedCount = provider.detected_count ?? 0;
  const embeddedCount = provider.embedded_count ?? 0;
  const hasIndexData = provider.detected_count !== null && provider.embedded_count !== null;
  const progress = hasIndexData && detectedCount > 0
    ? Math.min(100, Math.round((embeddedCount / detectedCount) * 100))
    : null;
  const canAct = provider.enabled && !isRefreshing;
  const isFullyIndexed = progress === 100;
  const canSync = canAct && (isSyncing || !isFullyIndexed);
  const ringCoverage = mounted && !isRefreshing && progress !== null ? progress : 0;

  return (
    <article aria-label={`${provider.display_name} provider`} className="admin-provider-card">
      <header className="admin-provider-card__header">
        <div className="admin-provider-card__identity">
          <span className="admin-provider-card__logo" aria-hidden="true">
            <ProviderLogo provider={provider.provider} size={22} />
          </span>
          <div>
            <h3>{provider.display_name}</h3>
            <span className={`admin-status ${healthClassName(provider.health)}`}>{healthLabel(provider.health)}</span>
          </div>
        </div>
        <button
          type="button"
          className="admin-icon-button"
          onClick={() => onRefresh(provider.provider)}
          disabled={isRefreshing}
          aria-label={`${isRefreshing ? "Refreshing" : "Refresh"} ${provider.display_name}`}
          title={`${isRefreshing ? "Refreshing" : "Refresh"} ${provider.display_name}`}
        >
          <span className={isRefreshing ? "admin-spin" : ""} aria-hidden="true">↻</span>
        </button>
      </header>

      <section className="admin-provider-card__index" aria-label={`${provider.display_name} vector indexing progress`}>
        <div className="admin-provider-card__metric">
          <strong>{!isRefreshing ? (hasIndexData ? `${embeddedCount} / ${detectedCount}` : "Loading") : ""}</strong>
          <span>{!isRefreshing ? "embedded" : ""}</span>
        </div>
        <div className="admin-provider-card__index-status">
          <div
            className={`admin-provider-ring ${isRefreshing ? "admin-provider-ring--spinning" : ""}`}
            style={{ "--coverage": ringCoverage } as React.CSSProperties}
            aria-hidden="true"
          >
            <span className={mounted && !isRefreshing && progress !== null ? "admin-provider-ring-text--visible" : ""}>
              {!isRefreshing && progress !== null ? `${progress}%` : ""}
            </span>
          </div>
          <span className="admin-provider-badge">{!isRefreshing && progress !== null ? `${progress}%` : ""}</span>
          {isRefreshing ? (
            <span className="admin-provider-status-text">Refreshing</span>
          ) : isSyncing ? (
            <span className="admin-provider-status-text">Syncing</span>
          ) : progress === 100 ? (
            <span className="admin-provider-status-text">Indexed</span>
          ) : progress === null ? (
            <span className="admin-provider-status-text">Loading</span>
          ) : null}
        </div>
      </section>

      <footer className="admin-provider-card__actions">
        <button
          type="button"
          className="admin-link-button"
          onClick={() => onOpenItems(provider.provider)}
          disabled={!canAct || isItemsLoading}
          aria-label={`View embedded items for ${provider.display_name}`}
        >
          {isItemsLoading ? "Loading" : `Items (${embeddedCount})`}
        </button>
        <button
          type="button"
          className={`admin-primary-button ${isSyncing ? "admin-primary-button--danger" : ""}`}
          onClick={() => onSync(provider.provider)}
          disabled={!canSync}
          aria-label={`${isSyncing ? "Stop syncing" : isFullyIndexed ? "Sync unavailable; fully indexed" : "Sync"} ${provider.display_name}`}
        >
          {isSyncing ? "Stop" : "Sync"}
        </button>
      </footer>
    </article>
  );
}
