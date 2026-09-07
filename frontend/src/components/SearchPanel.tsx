import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, getProviders, searchVectors } from "../api/client";
import type {
  ProviderMeta,
  StorageProvider,
  VectorSearchItem,
} from "../types";


import { SearchResultThumbnail } from "./SearchResultThumbnail";
import { ProviderLogo } from "./ProviderLogo";


const DEFAULT_TOP_K = 10;
const MIN_TOP_K = 1;
const MAX_TOP_K = 100;
const MAX_QUERY_LENGTH = 4190;

type ProviderFilter = "" | StorageProvider;

type SearchMode = "semantic" | "filename";
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
  onTopKChange,
}: SearchPanelProps = {}): JSX.Element {
  const [query, setQuery] = useState<string>("");
  const [internalTopK, setInternalTopK] = useState<string>(String(DEFAULT_TOP_K));
  const topK = externalTopK !== undefined ? externalTopK : internalTopK;
  const setTopK = onTopKChange || setInternalTopK;
  const [provider, setProvider] = useState<ProviderFilter>("");
  const [providers, setProviders] = useState<readonly ProviderMeta[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [sortBy, setSortBy] = useState<SortOrder>("relevance");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let isMounted = true;
    getProviders()
      .then((data) => {
        if (isMounted) setProviders(data);
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);


  useEffect(() => {
    if (!showSettings) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedButton = buttonRef.current && buttonRef.current.contains(target);
      const clickedPopover = popoverRef.current && popoverRef.current.contains(target);

      if (!clickedButton && !clickedPopover) {
        setShowSettings(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setShowSettings(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showSettings]);

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
    }
  }, [searchMode]);

  useEffect(() => {
    if (searchMode !== "filename") return;
    if (query.length > MAX_QUERY_LENGTH) return;

    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setState({ kind: "idle" });
      return;
    }

    let isMounted = true;
    const timer = setTimeout(async () => {
      try {
        const res = await searchVectors(
          trimmed,
          MAX_TOP_K,
          provider || undefined,
          "filename"
        );
        if (isMounted) {
          setState({ kind: "result", items: res.data });
        }
      } catch (err) {
        if (isMounted) {
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

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (query.length > MAX_QUERY_LENGTH) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setState({ kind: "submitting" });
    try {
      const res = await searchVectors(
        trimmed,
        searchMode === "semantic" ? clampTopK(topK) : MAX_TOP_K,
        provider || undefined,
        searchMode
      );
      setState({ kind: "result", items: res.data });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Search failed";
      setState({ kind: "error", message });
    }
  }

  const sortedItems =
    state.kind === "result"
      ? [...state.items].sort((a, b) => {
          if (searchMode !== "filename" || sortBy === "relevance") return 0;
          const timeA = parseTimestamp(a.modified_time);
          const timeB = parseTimestamp(b.modified_time);
          if (sortBy === "date_desc") {
            if (timeA === timeB) return 0;
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
          onClick={() => setSearchMode("semantic")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V14h-4V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z" />
            <path d="M9 18h6" />
            <path d="M10 22h4" />
          </svg>
          <span>Semantic AI</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={searchMode === "filename"}
          className={`search-mode-chip ${searchMode === "filename" ? "search-mode-chip--active" : ""}`}
          onClick={() => setSearchMode("filename")}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Filename Match</span>
        </button>
      </div>

      <form onSubmit={onSubmit}>
        <div className="search-bar-box">
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
                  : "Enter filename or extension (e.g. 'invoice.pdf', 'quarterly')..."
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

          <div className="search-bar-actions">
            <button
              ref={buttonRef}
              type="button"
              className={`config-btn ${showSettings ? "active" : ""} ${provider || (searchMode === "semantic" && topK !== String(DEFAULT_TOP_K)) ? "config-btn--active-filter" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Settings"
              title="Search Settings & Filters"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </button>

            <button
              className="primary"
              type="submit"
              disabled={state.kind === "submitting" || query.trim().length === 0}
            >
              {state.kind === "submitting" ? "Searching…" : "Search"}
            </button>
          </div>

          {showSettings && (
            <div className="config-popover glass" role="dialog" aria-label="Settings popover" ref={popoverRef}>
              <div className="popover-header">
                <h3>Search Options</h3>
                <button
                  type="button"
                  className="popover-close-btn"
                  onClick={() => setShowSettings(false)}
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>

              <div className="config-fields">
                <div>
                  <label className="field" htmlFor="search-mode">
                    Search Mode
                  </label>
                  <div className="input">
                    <select
                      id="search-mode"
                      value={searchMode}
                      onChange={(e) => setSearchMode(e.target.value as SearchMode)}
                    >
                      <option value="semantic">Semantic Search (AI)</option>
                      <option value="filename">Filename Search</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="field" htmlFor="search-provider">
                    Provider
                  </label>
                  <div className="input">
                    <select
                      id="search-provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as ProviderFilter)}
                    >
                      <option value="">All providers</option>
                      {providers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {searchMode === "semantic" && (
                  <div>
                    <label className="field" htmlFor="search-k">
                      Search Results
                    </label>
                    <div className="input">
                      <input
                        id="search-k"
                        type="number"
                        min={MIN_TOP_K}
                        max={MAX_TOP_K}
                        value={topK}
                        onChange={(e) => setTopK(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </form>

      {/* Quick Provider Filters */}
      {providers.length > 0 && (
        <div className="search-quick-providers" aria-label="Filter by provider">
          <button
            type="button"
            className={`search-filter-chip ${provider === "" ? "search-filter-chip--active" : ""}`}
            onClick={() => setProvider("")}
          >
            All providers
          </button>
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`search-filter-chip ${provider === p.id ? "search-filter-chip--active" : ""}`}
              onClick={() => setProvider(provider === p.id ? "" : (p.id as ProviderFilter))}
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
            {searchMode === "filename" && (
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
                  : "Check the filename spelling or switch to Semantic Search."}
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
                        <span className="result-provider-pill" title={`Storage provider: ${item.provider}`}>
                          <ProviderLogo provider={item.provider} size={12} />
                          <span style={{ textTransform: "capitalize" }}>{item.provider.replace(/_/g, " ")}</span>
                        </span>
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
