import { Spinner } from "./ui/Spinner";
import type { ModelHealthStatus } from "../types";
import styles from "./AdminModelHealth.module.css";
export interface AdminModelHealthProps {
  readonly embeddingModel: ModelHealthStatus | null;
  readonly descriptionModel: ModelHealthStatus | null;
  readonly videoModel?: ModelHealthStatus | null;
  readonly isLoading?: boolean;
}
export function AdminModelHealth({
  embeddingModel,
  descriptionModel,
  videoModel,
  isLoading,
}: AdminModelHealthProps): JSX.Element {
  return (
    <section
      aria-label="Model health"
      aria-busy={!!isLoading}
      className={styles.models}
    >
      {(
        [
          ["Embedding", embeddingModel],
          ["Image descriptions", descriptionModel],
          ["Video descriptions", videoModel ?? { name: "Not configured", health: "disabled" }],
        ] as const
      ).map(([role, model]) => (
        <article key={role}>
          <p>{role}</p>
          <h2>
            {model?.name ?? (isLoading ? "\u00a0" : "Unavailable")}
          </h2>
          <span data-status={isLoading ? "checking" : model?.health === "ok" ? "ready" : "unavailable"}>
            {isLoading
              ? <Spinner label="Checking model health" />
              : model?.health === "ok"
                ? "Ready"
                : model?.health === "disabled"
                  ? "Not configured"
                  : "Unavailable"}
          </span>
        </article>
      ))}
    </section>
  );
}
