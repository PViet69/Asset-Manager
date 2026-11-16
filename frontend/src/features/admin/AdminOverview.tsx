import { Spinner } from "../../components/ui/Spinner";
import { Button } from "../../components/ui/Button";
import type { DashboardState } from "./admin.types";
import styles from "./AdminOverview.module.css";
export function AdminOverview({
  dashboard,
  isLoading,
  onRefresh,
}: {
  dashboard: DashboardState;
  isLoading: boolean;
  onRefresh(): void;
}): JSX.Element {
  function total(key: "detected_count" | "embedded_count") {
    return dashboard.providers.length &&
      dashboard.providers.every((p) => p[key] !== null)
      ? dashboard.providers.reduce((n, p) => n + (p[key] ?? 0), 0)
      : null;
  }
  const detected = total("detected_count");
  const indexed = total("embedded_count");
  const counts = [
    ["Detected", detected],
    ["Indexed", indexed],
    [
      "Pending",
      detected === null || indexed === null
        ? null
        : Math.max(0, detected - indexed),
    ],
  ] as const;
  return (
    <>
      <div className={styles.actions}>
        <Button onPress={onRefresh} isDisabled={isLoading}>
          {isLoading ? <Spinner label="Refreshing status" small /> : "Refresh status"}
        </Button>
      </div>
      <section
        aria-label="Key operational metrics"
        aria-busy={isLoading}
        className={styles.metrics}
      >
        {counts.map(([label, value]) => (
          <article key={label}>
            <span>{label}</span>
            <strong>
              {isLoading
                ? <Spinner label={`Loading ${label.toLowerCase()}`} />
                : value === null
                  ? "Unavailable"
                  : value.toLocaleString()}
            </strong>
          </article>
        ))}
      </section>
    </>
  );
}
