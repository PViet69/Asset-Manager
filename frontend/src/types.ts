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

export type AdminSyncStatusResponse = { providers: ProviderSyncStatus[] };

export type AdminSyncResponse = {
  provider: string;
  upserted: number;
  deleted: number;
  unchanged: number;
  failed: number;
  traces: SyncTraceItem[];
};
