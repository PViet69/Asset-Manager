import type { ModelHealthStatus } from "../types";
import styles from "./AdminModelHealth.module.css";
export interface AdminModelHealthProps {
  readonly embeddingModel: ModelHealthStatus | null;
  readonly descriptionModel: ModelHealthStatus | null;
  readonly isLoading?: boolean;
}
export function AdminModelHealth({
  embeddingModel,
  descriptionModel,
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
          ["Description", descriptionModel],
        ] as const
      ).map(([role, model]) => (
        <article key={role}>
          <p>{role === "Description" ? "Vision & Caption" : role}</p>
          <h2>{role} model:</h2>
          <strong>
            {isLoading ? "Loading…" : (model?.name ?? "Unavailable")}
          </strong>
          <span>
            {isLoading
              ? "Checking"
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
