import type { ModelHealthStatus } from "../types";

export interface AdminModelHealthProps {
  readonly embeddingModel: ModelHealthStatus | null;
  readonly descriptionModel: ModelHealthStatus | null;
}

function healthLabel(health: string): string {
  if (health === "ok") return "Ready";
  if (health === "disabled") return "Not configured";
  return "Unavailable";
}

export function AdminModelHealth({ embeddingModel, descriptionModel }: AdminModelHealthProps): JSX.Element {
  const models = [
    {
      role: "Embedding",
      badge: "Embedding",
      model: embeddingModel,
    },
    {
      role: "Description",
      badge: "Vision & Caption",
      model: descriptionModel,
    },
  ].filter((entry): entry is { role: string; badge: string; model: ModelHealthStatus } => entry.model !== null);

  return (
    <section className="admin-model-health" aria-label="Model health">
      {models.map(({ role, badge, model }) => (
        <article className="admin-model-health__card" key={role}>
          <div className="admin-model-health__head">
            <span className={`admin-model-badge ${role === "Description" ? "vision" : ""}`}>{badge}</span>
            <span className={`admin-model-state admin-model-state--${model.health}`}>
              <span className="admin-model-state-dot" aria-hidden="true" />
              <small>{healthLabel(model.health)}</small>
            </span>
          </div>
          <div className="admin-model-health__name">
            <span>{role} model:</span>
            <strong>{model.name}</strong>
          </div>
        </article>
      ))}
    </section>
  );
}
