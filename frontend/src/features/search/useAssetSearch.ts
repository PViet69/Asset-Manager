import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  getApprovedTags,
  getProviders,
  searchVectors,
} from "../../api/client";
import type { ProviderMeta, TagGroup } from "../../types";
import type {
  SearchFilters,
  SearchMode,
  SearchState,
  SortOrder,
} from "./search.types";
export const MAX_QUERY_LENGTH = 4190;
const timestamp = (value?: string | null) =>
  value ? new Date(value).getTime() || 0 : 0;
export function useAssetSearch({
  externalTopK,
}: { externalTopK?: string } = {}) {
  const [query, updateQuery] = useState("");
  const [mode, updateMode] = useState<SearchMode>("semantic");
  const [filters, setFilters] = useState<SearchFilters>({
    provider: "",
    tags: [],
  });
  const [providers, setProviders] = useState<readonly ProviderMeta[]>([]);
  const [tagGroups, setTagGroups] = useState<readonly TagGroup[]>([]);
  const [sort, setSort] = useState<SortOrder>("relevance");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void getProviders()
      .then((data) => {
        if (mounted.current) setProviders(data);
      })
      .catch(() => {});
    void getApprovedTags()
      .then((data) => {
        if (mounted.current) setTagGroups(data.groups);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, []);
  async function performSearch(
    target: SearchFilters,
    id = ++request.current,
  ): Promise<void> {
    if (
      id !== request.current ||
      !mounted.current ||
      query.length > MAX_QUERY_LENGTH ||
      !query.trim()
    )
      return;
    const parsed = Number.parseInt(externalTopK ?? "10", 10);
    const limit =
      mode === "filename"
        ? 100
        : Number.isFinite(parsed)
          ? Math.max(1, Math.min(100, parsed))
          : 10;
    setState({ kind: "submitting" });
    try {
      const args = [
        query.trim(),
        limit,
        target.provider || undefined,
        mode,
      ] as const;
      const result = target.tags.length
        ? await searchVectors(...args, [...target.tags])
        : await searchVectors(...args);
      if (mounted.current && request.current === id)
        setState({ kind: "result", items: result.data });
    } catch (error) {
      if (mounted.current && request.current === id)
        setState({
          kind: "error",
          message: error instanceof ApiError ? error.message : "Search failed",
        });
    }
  }
  function setQuery(value: string) {
    request.current++;
    updateQuery(value);
    setState((current) =>
      current.kind === "submitting" || !value.trim()
        ? { kind: "idle" }
        : current,
    );
  }
  function setMode(value: SearchMode) {
    if (value === mode) return;
    request.current++;
    updateMode(value);
    updateQuery("");
    setState({ kind: "idle" });
    if (value === "semantic") setSort("relevance");
  }
  function applyFilters(value: SearchFilters) {
    request.current++;
    setFilters({ provider: value.provider, tags: [...value.tags] });
    if (
      mode === "semantic" &&
      (state.kind === "result" || state.kind === "submitting")
    )
      void performSearch(value);
  }
  useEffect(() => {
    if (mode !== "filename" || query.length > MAX_QUERY_LENGTH || !query.trim())
      return;
    const id = ++request.current;
    const timer = setTimeout(() => {
      void performSearch(filters, id);
    }, 150);
    return () => {
      clearTimeout(timer);
    };
  }, [query, mode, filters]);
  useEffect(() => {
    if (state.kind !== "error" || state.message === "Model not found") return;
    const timer = setTimeout(() => setState({ kind: "idle" }), 5000);
    return () => clearTimeout(timer);
  }, [state]);
  const sortedItems =
    state.kind === "result"
      ? [...state.items].sort((a, b) => {
          if (mode === "semantic" || sort === "relevance") return 0;
          const x = timestamp(a.modified_time),
            y = timestamp(b.modified_time);
          return sort === "date_asc"
            ? x - y
            : x === y
              ? 0
              : x === 0
                ? 1
                : y === 0
                  ? -1
                  : y - x;
        })
      : [];
  return {
    query,
    setQuery,
    mode,
    setMode,
    filters,
    applyFilters,
    providers,
    tagGroups,
    sort,
    setSort,
    state,
    sortedItems,
    submit: () => performSearch(filters),
    dismissError: () => setState({ kind: "idle" }),
  };
}
