import { Spinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import { ProviderLogo } from "../../components/ProviderLogo";
import type { DashboardState } from "./admin.types";
import styles from "./AdminProviders.module.css";
function isUpToDate(provider: DashboardState["providers"][number]): boolean {
  return provider.detected_count !== null && provider.embedded_count !== null && provider.embedded_count >= provider.detected_count;
}

type Controls = {
  refreshingProviders: ReadonlySet<string>;
  syncingProviders: ReadonlySet<string>;
  stoppingProviders: ReadonlySet<string>;
  onRefresh(id: string): void;
  onBrowse(id: string): void;
  onStart(id: string): void;
  onStop(id: string): void;
};
export function AdminProviders({
  dashboard,
  controls,
  isLoading = false,
}: {
  dashboard: DashboardState;
  controls: Controls;
  isLoading?: boolean;
}): JSX.Element {
  return (
    <section aria-label="Storage providers" aria-busy={isLoading} className={styles.panel}>
      <h2>Storage providers</h2>
      {isLoading && dashboard.providers.length === 0 ? (
        <>
          <span role="status" className={styles.srOnly}>Loading storage providers…</span>
          <div className={styles.list} aria-hidden="true">
            {[0, 1].map((row) => (
              <div className={styles.row} key={row}>
                <div className={styles.identity}>
                  <span className={`${styles.skeleton} ${styles.logoSkeleton}`} />
                  <div className={styles.skeletonIdentity}>
                    <span className={`${styles.skeleton} ${styles.nameSkeleton}`} />
                    <span className={`${styles.skeleton} ${styles.badgeSkeleton}`} />
                  </div>
                </div>
                <div className={styles.counts}>
                  {[0, 1, 2].map((count) => <div className={styles.skeletonMetric} key={count}><span className={`${styles.skeleton} ${styles.labelSkeleton}`} /><span className={`${styles.skeleton} ${styles.valueSkeleton}`} /></div>)}
                </div>
                <div className={styles.actions}>
                  {[0, 1, 2].map((action) => <span className={`${styles.skeleton} ${styles.buttonSkeleton}`} key={action} />)}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : dashboard.providers.length === 0 ? (
        <p>
          No storage providers are available. Refresh status in Settings to try
          again.
        </p>
      ) : (
        <ul className={styles.list}>
          {dashboard.providers.map((p) => (
            <li key={p.provider} className={styles.row}>
              <div className={styles.identity}>
                <ProviderLogo provider={p.provider} aria-hidden="true" />
                <div>
                  <h3>{p.display_name}</h3>
                  <span data-health={p.enabled ? p.health : "disabled"}>
                    {p.enabled
                      ? p.health === "ok"
                        ? "Connected"
                        : p.health
                      : "Disabled"}
                  </span>
                </div>
              </div>
              <dl className={styles.counts}>
                <div>
                  <dt>Detected</dt>
                  <dd>{p.detected_count ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Indexed</dt>
                  <dd>{p.embedded_count ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Pending</dt>
                  <dd>
                    {p.detected_count === null || p.embedded_count === null
                      ? "Unavailable"
                      : Math.max(0, p.detected_count - p.embedded_count)}
                  </dd>
                </div>
              </dl>
              <div className={styles.actions}>
                <Button
                  onPress={() => controls.onBrowse(p.provider)}
                  aria-label={`View embedded items for ${p.display_name}`}
                >
                  Browse items
                </Button>
                <Button
                  onPress={() => controls.onRefresh(p.provider)}
                  isDisabled={controls.refreshingProviders.has(p.provider)}
                  aria-label={`Refresh ${p.display_name}`}
                  data-refreshing={controls.refreshingProviders.has(p.provider)}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></svg>
                  <span className={styles.srOnly}>{controls.refreshingProviders.has(p.provider) ? "Refreshing…" : "Refresh"}</span>
                </Button>
                {controls.syncingProviders.has(p.provider) ? (
                  <Button
                    variant="danger"
                    onPress={() => controls.onStop(p.provider)}
                    isDisabled={controls.stoppingProviders.has(p.provider)}
                    aria-label={`Stop syncing ${p.display_name}`}
                  >
                    {controls.stoppingProviders.has(p.provider)
                      ? <Spinner label="Stopping sync" small />
                      : "Stop sync"}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    onPress={() => controls.onStart(p.provider)}
                    isDisabled={!p.enabled || isUpToDate(p)}
                    aria-label={`Sync ${p.display_name}`}
                  >
                    {isUpToDate(p) ? "Up to date" : "Sync"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
