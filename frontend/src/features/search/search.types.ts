import type { VectorSearchItem } from "../../types";
export type SearchMode = "semantic" | "filename";
export type SortOrder = "relevance" | "date_desc" | "date_asc";
export type SearchFilters = { provider: string; tags: readonly string[] };
export type SearchState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "result"; items: VectorSearchItem[] }
  | { kind: "error"; message: string };
export type SearchPanelProps = {
  externalTopK?: string;
  onTopKChange?: (topK: string) => void;
};
