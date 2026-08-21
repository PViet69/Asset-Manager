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
  drive_id?: string | null;
};

export type VectorSearchResponse = {
  object: "list";
  data: VectorSearchItem[];
};
