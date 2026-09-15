import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, getApprovedTags, getProviders, searchVectors } from "../api/client";
import type {
  ProviderMeta,
  StorageProvider,
  TagGroup,
  VectorSearchItem,
} from "../types";


import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { ProviderLogo } from "./ProviderLogo";


const DEFAULT_TOP_K = 10;
const MIN_TOP_K = 1;
const MAX_TOP_K = 100;
const MAX_QUERY_LENGTH = 4190;

type ProviderFilter = "" | StorageProvider;

type SearchMode = "semantic" | "filename" | "tag";

function displayTag(tag: string): string {
  return tag.split(":", 2)[1] ?? tag;
}
type SortOrder = "relevance" | "date_desc" | "date_asc";

type SearchState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "result"; items: VectorSearchItem[] }
  | { kind: "error"; message: string };

function formatScore(score: number): string {
  return score.toFixed(3);
}

function parseTimestamp(dateStr?: string | null): number {
  if (!dateStr) return 0;
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function clampTopK(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TOP_K;
  return Math.max(MIN_TOP_K, Math.min(MAX_TOP_K, parsed));
}

export type SearchPanelProps = {
  externalTopK?: string;
  onTopKChange?: (topK: string) => void;
};

export function SearchPanel({
  externalTopK,
}: SearchPanelProps = {}): JSX.Element {
  const [query, setQuery] = useState<string>("");
  const topK = externalTopK ?? String(DEFAULT_TOP_K);
  const [provider, setProvider] = useState<ProviderFilter>("");
  const [providers, setProviders] = useState<readonly ProviderMeta[]>([]);
  const [tagGroups, setTagGroups] = useState<readonly TagGroup[]>([]);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [sortBy, setSortBy] = useState<SortOrder>("relevance");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    let isMounted = true;
    getProviders()
      .then((data) => {
        if (isMounted) setProviders(data);
      })
      .catch(() => {});
    getApprovedTags()
      .then((data) => {
        if (isMounted) setTagGroups(data.groups);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  function toggleTag(tag: string): void {
    setSelectedTags((current) =>
      current.includes(tag)
        ? current.filter((selected) => selected !== tag)
        : [...current, tag]
    );
  }

  function changeSearchMode(mode: SearchMode): void {
    searchRequestIdRef.current++;
    setSearchMode(mode);
    setState({ kind: "idle" });
  }

  useEffect(() => {
    if (state.kind !== "error") return;
    const timer = setTimeout(() => {
      setState({ kind: "idle" });
    }, 5000);
    return () => clearTimeout(timer);
  }, [state]);

  useEffect(() => {
    if (searchMode === "semantic") {
      setSortBy("relevance");
    } else if (searchMode === "tag") {
      setSortBy("date_desc");
    }
  }, [searchMode]);

  useEffect(() => {
    if (searchMode !== "filename") return;
    if (query.length > MAX_QUERY_LENGTH) return;

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      searchRequestIdRef.current++;
      setState({ kind: "idle" });
      return;
    }

    const reqId = ++searchRequestIdRef.current;
    let isMounted = true;
    const timer = setTimeout(async () => {
      try {
        const res = await searchVectors(
          trimmed,
          MAX_TOP_K,
          provider || undefined,
          "filename"
        );
        if (isMounted && searchRequestIdRef.current === reqId) {
          setState({ kind: "result", items: res.data });
        }
      } catch (err) {
        if (isMounted && searchRequestIdRef.current === reqId) {
          const message =
            err instanceof ApiError ? err.message : "Search failed";
          setState({ kind: "error", message });
        }
      }
    }, 150);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [query, provider, searchMode]);

  async function performSearch(
    targetQuery: string,
    targetProvider: ProviderFilter,
    targetMode: SearchMode,
    targetTags: readonly string[]
  ): Promise<void> {
    if (targetQuery.length > MAX_QUERY_LENGTH) return;
    const trimmed = targetQuery.trim();
    if (targetMode !== "tag" && trimmed.length === 0) return;
    if (targetMode === "tag" && targetTags.length === 0) return;

    const reqId = ++searchRequestIdRef.current;
    setState({ kind: "submitting" });
    try {
      const args = [
        targetMode === "tag" ? "" : trimmed,
        targetMode === "semantic" ? clampTopK(topK) : MAX_TOP_K,
        targetProvider || undefined,
        targetMode,
      ] as const;
      const res =
        targetMode === "tag"
          ? await searchVectors(...args, [...targetTags])
          : await searchVectors(...args);
      if (searchRequestIdRef.current === reqId) {
        setState({ kind: "result", items: res.data });
      }
    } catch (err) {
      if (searchRequestIdRef.current === reqId) {
        const message =
          err instanceof ApiError ? err.message : "Search failed";
        setState({ kind: "error", message });
      }
    }
  }

  function handleProviderChange(nextProvider: ProviderFilter): void {
    setProvider(nextProvider);
    if (state.kind === "result" || state.kind === "submitting") {
      if (searchMode === "semantic" || searchMode === "tag") {
        void performSearch(query, nextProvider, searchMode, selectedTags);
      }
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await performSearch(query, provider, searchMode, selectedTags);
  }

  const sortedItems =
    state.kind === "result"
      ? [...state.items].sort((a, b) => {
          if (searchMode === "semantic" || sortBy === "relevance") return 0;
          const timeA = parseTimestamp(a.modified_time);
          const timeB = parseTimestamp(b.modified_time);
          if (sortBy === "date_desc") {
            if (timeA === timeB) return 0;
            if (timeA === 0) return 1;
            if (timeB === 0) return -1;
            return timeB - timeA;
          }
          if (sortBy === "date_asc") {
            if (timeA === timeB) return 0;
            return timeA - timeB;
          }
          return 0;
        })
      : [];

  return (
    <section className="glass panel-card" role="tabpanel">
      {/* Mode Switcher Tabs */}
      <div className="search-mode-tabs" role="tablist" aria-label="Search mode selector">
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "semantic"}
          className={`search-mode-chip ${searchMode === "semantic" ? "search-mode-chip--active" : ""}`}
          onClick={() => changeSearchMode("semantic")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V14h-4V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
          </svg>
          <span>Description Search</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "filename"}
          className={`search-mode-chip ${searchMode === "filename" ? "search-mode-chip--active" : ""}`}
          onClick={() => changeSearchMode("filename")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Filename Search</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "tag"}
          className={`search-mode-chip ${searchMode === "tag" ? "search-mode-chip--active" : ""}`}
          onClick={() => changeSearchMode("tag")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
            <line x1="7" y1="7" x2="7.01" y2="7" />
          </svg>
          <span>Tag Search</span>
        </button>
      </div>

      <form onSubmit={onSubmit}>
        <div className={`search-bar-box ${searchMode === "tag" ? "search-bar-box--tag" : ""}`}>
          {searchMode === "tag" ? (
            <div className="search-tag-picker" aria-label="Approved tags">
              <div className="search-tag-picker__header">
                <div className="search-tag-picker__title-group">
                  <span className="search-tag-picker__title">Filter by Tags</span>
                  <span className="search-tag-picker__sub">Select approved tags to find matching assets</span>
                </div>

                {selectedTags.length > 0 && (
                  <button
                    type="button"
                    className="search-tag-picker__clear-btn"
                    onClick={() => setSelectedTags([])}
                    aria-label="Clear selected tags"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {selectedTags.length > 0 && (
                <div className="search-tag-selected-tray" aria-label="Selected tags">
                  <span className="search-tag-selected-tray__label">Selected:</span>
                  <span className="search-tag-picker__badge" aria-label={`${selectedTags.length} selected`}>
                    {selectedTags.length}
                  </span>
                  <div className="search-tag-selected-tray__chips">
                    {selectedTags.map((tag) => (
                      <span key={tag} className="search-tag-selected-chip">
                        <span>{displayTag(tag)}</span>
                        <button
                          type="button"
                          className="search-tag-selected-chip__remove"
                          onClick={() => toggleTag(tag)}
                          aria-label={`Remove tag ${displayTag(tag)}`}
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {tagGroups.length === 0 ? (
                <div className="search-tag-picker__empty">
                  <span className="hint">No approved tags are available.</span>
                </div>
              ) : (
                <div className="search-tag-groups">
                  {tagGroups.map((group) => (
                    <fieldset key={group.category} className="search-tag-group">
                      <div className="search-tag-group__header">
                        <legend className="search-tag-group__legend">{group.category}</legend>
                        <span className="search-tag-group__count">
                          {group.tags.length}
                        </span>
                      </div>
                      <div className="search-tag-group__chips">
                        {group.tags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            className={`search-filter-chip ${selectedTags.includes(tag) ? "search-filter-chip--active" : ""}`}
                            onClick={() => toggleTag(tag)}
                            aria-pressed={selectedTags.includes(tag)}
                          >
                            {displayTag(tag)}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="search-input-wrapper">
              <svg
                className="search-bar-icon"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>

              <input
                id="search-q"
                type="text"
                aria-label="Query"
                maxLength={MAX_QUERY_LENGTH}
                placeholder={
                  searchMode === "semantic"
                    ? "Describe what you're looking for (e.g. 'financial forecast Q3', 'brand logo')..."
                    : "Enter filename or extension (e.g. 'brand-logo.png', 'quarterly')..."
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoComplete="off"
              />

              {query.length > 0 && (
                <button
                  type="button"
                  className="search-clear-btn"
                  onClick={() => setQuery("")}
                  aria-label="Clear search input"
                >
                  ✕
                </button>
              )}
            </div>
          )}

          <div className="search-bar-actions">
            <button
              className="primary"
              type="submit"
              disabled={
                state.kind === "submitting" ||
                (searchMode === "tag"
                  ? selectedTags.length === 0
                  : query.trim().length === 0)
              }
            >
              {state.kind === "submitting" ? "Searching…" : "Search"}
            </button>
          </div>
        </div>
      </form>

      {/* Quick Provider Filters */}
      {providers.length > 0 && (
        <div className="search-quick-providers" aria-label="Filter by provider">
          <span className="search-quick-providers__label">Provider:</span>
          <button
            type="button"
            className={`search-filter-chip ${provider === "" ? "search-filter-chip--active" : ""}`}
            onClick={() => handleProviderChange("")}
          >
            All providers
          </button>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`search-filter-chip ${provider === p.id ? "search-filter-chip--active" : ""}`}
              onClick={() => handleProviderChange(provider === p.id ? "" : (p.id as ProviderFilter))}
            >
              <ProviderLogo provider={p.id} size={13} />
              <span>{p.displayName}</span>
            </button>
          ))}
        </div>
      )}

      {state.kind === "submitting" && (
        <div className="results" aria-busy="true" aria-label="Loading search results">
          <h3>Searching...</h3>
          <ul className="list">
            {[1, 2, 3].map((i) => (
              <li key={i} className="skeleton-card">
                <div className="row-line" style={{ gap: "14px" }}>
                  <div className="skeleton-box" style={{ width: "46px", height: "46px", borderRadius: "10px", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div className="skeleton-box" style={{ width: "45%", height: "16px", marginBottom: "8px" }} />
                    <div className="skeleton-box" style={{ width: "85%", height: "12px" }} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {state.kind === "error" && (
        <div className="banner" role="alert">
          {state.message}
        </div>
      )}

      {state.kind === "result" && (
        <div className="results">
          <div
            className="results-header"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <h3 style={{ margin: 0 }}>Result</h3>
              <span className="results-count-badge">
                {sortedItems.length} {sortedItems.length === 1 ? "match" : "matches"}
              </span>
            </div>
            {(searchMode === "filename" || searchMode === "tag") && (
              <div
                className="results-sort"
                style={{ display: "flex", alignItems: "center", gap: "8px" }}
              >
                <label htmlFor="results-sort-select" className="field" style={{ margin: 0, fontSize: "11px" }}>
                  Sort by:
                </label>
                <div className="input" style={{ padding: "0 8px" }}>
                  <select
                    id="results-sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortOrder)}
                    aria-label="Sort by date"
                    style={{ padding: "4px 0", fontSize: "12px" }}
                  >
                    <option value="relevance">Default</option>
                    <option value="date_desc">Date: Newest first</option>
                    <option value="date_asc">Date: Oldest first</option>
                  </select>
                </div>
              </div>
            )}
          </div>

          {sortedItems.length === 0 ? (
            <div className="results-empty">
              <div className="results-empty__icon">🔍</div>
              <h4>No matching assets found</h4>
              <p>
                {searchMode === "semantic"
                  ? "Try using different keywords or describing concepts more broadly."
                  : searchMode === "filename"
                    ? "Check the filename spelling or switch to Semantic Search."
                    : "Choose different approved tags or remove a filter."}
              </p>
            </div>
          ) : (
            <ul className="list search-results--entering" aria-label="Search results">
              {sortedItems.map((item, index) => {
                const sourceUrl = item.source_url ?? null;
                const animationStyle = { "--result-index": index } as CSSProperties;
                const formattedDate = item.modified_time
                  ? new Date(item.modified_time).toLocaleDateString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })
                  : null;
                return (
                  <li key={item.point_id} style={animationStyle}>
                    <div className="row-line">
                      <SearchResultThumbnail
                        thumbnailUrl={item.thumbnail_url}
                        filename={item.filename}
                      />
                      <div className="result-name">
                        {sourceUrl ? (
                          <a
                            href={sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="fname"
                            style={{
                              color: "var(--accent-2)",
                              textDecoration: "none",
                            }}
                            title={item.filename}
                          >
                            {item.filename} <span style={{ fontSize: "11px" }}>↗</span>
                          </a>
                        ) : (
                          <span className="fname" title={item.filename}>
                            {item.filename}
                          </span>
                        )}
                      </div>
                      {item.provider && (
                        <button
                          type="button"
                          className="result-provider-pill"
                          title={`Filter by ${item.provider.replace(/_/g, " ")}`}
                          onClick={() => handleProviderChange(provider === item.provider ? "" : (item.provider as ProviderFilter))}
                        >
                          <ProviderLogo provider={item.provider} size={12} />
                          <span style={{ textTransform: "capitalize" }}>{item.provider.replace(/_/g, " ")}</span>
                        </button>
                      )}
                      {formattedDate && (
                        <span
                          className="meta-date"
                          style={{
                            fontSize: "12px",
                            color: "var(--text-muted)",
                            marginRight: "8px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formattedDate}
                        </span>
                      )}
                      {searchMode === "semantic" && (
                        <span className="score">{formatScore(item.score)}</span>
                      )}
                    </div>
                    <div className="snippet" title={item.content}>{item.content}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
