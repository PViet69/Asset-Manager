// Storage provider types
export type StorageProvider = string;

export interface ProviderMeta {
  readonly id: string;
  readonly displayName: string;
}






// Mirrors backend/app/api/schemas/file_embeddings.py
export type FileStatus = "success" | "failed";


export type FileEmbeddingItem = {
  filename: string;
  content_type: string;
  status: FileStatus;
  reason: string | null;
};

export type FileEmbeddingResponse = {
  object: "list";
  data: FileEmbeddingItem[];
};

// Mirrors backend/app/api/schemas/vector_search.py
export type VectorSearchItem = {
  point_id: string;
  score: number;
  filename: string;
  file_path: string;
  file_type: string;
  content: string;
  source_url?: string | null;
  provider?: string | null;
  storage_file_id?: string | null;
  thumbnail_url?: string | null;
  modified_time?: string | null;
};

export type VectorSearchResponse = {
  object: "list";
  data: VectorSearchItem[];
};

export type SyncTraceItem = {
  timestamp: string;
  provider: string;
  step: string;
  status: string;
  detail: string;
  filename: string | null;
  storage_file_id: string | null;
};

export type ProviderSyncStatus = {
  provider: string;
  display_name: string;
  enabled: boolean;
  health: string;
  last_upserted: number | null;
  last_deleted: number | null;
  last_unchanged: number | null;
  last_failed: number | null;
  last_traces: SyncTraceItem[];
};

export type ModelHealthStatus = { name: string; health: string };

export type ProviderDashboardStatus = {
  provider: string;
  display_name: string;
  enabled: boolean;
  health: string;
  detected_count: number | null;
  embedded_count: number | null;
};

export type AdminDashboardStatusResponse = {
  providers: ProviderDashboardStatus[];
  embedding_model: ModelHealthStatus;
  description_model: ModelHealthStatus;
};

export type AdminProviderRefreshResponse = {
  provider: ProviderDashboardStatus;
  embedding_model: ModelHealthStatus;
  description_model: ModelHealthStatus;
};

export type SyncActivityEvent = {
  sequence: number;
  provider: string;
  filename: string | null;
  status: "loading" | "embedding" | "done" | "failed";
  detail: string;
  terminal: false;
};

export type SyncTerminalEvent = {
  sequence: number;
  provider: string;
  detected_count: number | null;
  embedded_count: number | null;
  upserted: number;
  deleted: number;
  unchanged: number;
  failed: number;
  terminal: true;
};

export type SyncEvent = SyncActivityEvent | SyncTerminalEvent;

export type AdminAccount = { username: string };

export type AdminSyncStatusResponse = { providers: ProviderSyncStatus[] };

export type AdminSyncResponse = {
  provider: string;
  upserted: number;
  deleted: number;
  unchanged: number;
  failed: number;
  traces: SyncTraceItem[];
};

export type AdminReindexResponse = {
  provider: string;
  storage_file_id: string;
  deleted: number;
};

export type AdminDeletePointResponse = {
  point_id: string;
  deleted: number;
};

export type QdrantItem = {
  point_id: string;
  filename?: string | null;
  file_path?: string | null;
  storage_file_id?: string | null;
  file_type?: string | null;
  thumbnail_url?: string | null;
  modified_time?: string | null;
};

export type AdminQdrantItemsResponse = {
  provider: string;
  items: QdrantItem[];
};


