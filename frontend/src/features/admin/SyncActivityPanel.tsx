import type { ProviderDashboardStatus, SyncActivityEvent } from "../../types";
import { ProviderLogo } from "../../components/ProviderLogo";
import type { ProviderActivityState } from "./syncActivity";
import styles from "./SyncActivityPanel.module.css";
const statusLabel = {
  preparing: "Preparing",
  indexing: "Indexing",
  indexed: "Indexed",
  failed: "Failed",
  stopped: "Stopped",
};
function media(name: string | null) {
  return /\.(mp4|mov|webm|avi|mkv)$/i.test(name ?? "")
    ? "Video"
    : /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name ?? "")
      ? "Image"
      : "File";
}
export function SyncActivityPanel({
  providers,
  activity,
  history = false,
}: {
  providers: readonly ProviderDashboardStatus[];
  activity: Readonly<Record<string, ProviderActivityState>>;
  history?: boolean;
}): JSX.Element {
  const active = Object.entries(activity).flatMap(([id, state]) =>
    state.active.map((event) => ({ id, event })),
  );
  const recent = Object.entries(activity).flatMap(([id, state]) =>
    state.recent.map((event) => ({ id, event })),
  );
  function row(id: string, event: SyncActivityEvent) {
    const provider = providers.find((p) => p.provider === id);
    return (
      <li key={`${id}-${event.sequence}`} className={styles.row}>
        <ProviderLogo provider={id} aria-hidden="true" />
        <span className={styles.icon} aria-label={media(event.filename)}>
          {media(event.filename) === "Video"
            ? "▷"
            : media(event.filename) === "Image"
              ? "▧"
              : "▤"}
        </span>
        <div className={styles.name}>
          <strong>{event.filename ?? "Preparing provider"}</strong>
          <span>{provider?.display_name ?? id}</span>
        </div>
        <span>{statusLabel[event.status]}</span>
      </li>
    );
  }
  return (
    <section
      aria-label={history ? "Session activity" : "Indexing now"}
      className={styles.panel}
    >
      <h2>{history ? "Session activity" : "Indexing now"}</h2>
      {history && <p className={styles.caption}>Recent events from this session.</p>}
      {!history && (
        <>
          <p role="status">
            {active.length
              ? "Indexing is active."
              : "No files are currently being indexed."}
          </p>
          <ul className={styles.list}>
            {active.map(({ id, event }) => row(id, event))}
          </ul>
        </>
      )}
      {Object.entries(activity)
        .filter(
          ([, s]) =>
            s.connection === "interrupted" || s.connection === "stopped",
        )
        .map(([id, s]) => (
          <p key={id}>
            {providers.find((p) => p.provider === id)?.display_name ?? id}:{" "}
            {s.connection === "interrupted"
              ? "Connection interrupted"
              : "Sync stopped"}
          </p>
        ))}
      {(history || recent.length > 0) && (
        <>
          <h3>Recent activity</h3>
          {recent.length ? (
            <ul className={styles.list}>
              {recent.map(({ id, event }) => row(id, event))}
            </ul>
          ) : (
            <p>No recent activity in this session.</p>
          )}
        </>
      )}
    </section>
  );
}
