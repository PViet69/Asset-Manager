import type {
  ModelHealthStatus,
  ProviderDashboardStatus,
  QdrantItem,
} from "../../types";
export type DashboardState = {
  providers: readonly ProviderDashboardStatus[];
  embeddingModel: ModelHealthStatus | null;
  descriptionModel: ModelHealthStatus | null;
};
export type Toast = { id: string; type: "status" | "error"; message: string };
export type PendingDeletion = { providerId: string; item: QdrantItem };
export type ControllerOptions = {
  enabled: boolean;
  onError(error: unknown, fallback: string): void;
};
export const EMPTY_DASHBOARD: DashboardState = {
  providers: [],
  embeddingModel: null,
  descriptionModel: null,
};
