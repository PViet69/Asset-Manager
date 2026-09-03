import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, searchVectors } from "../api/client";
import type { VectorSearchItem } from "../types";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

const DEFAULT_TOP_K = 10;
const MIN_TOP_K = 1;
const MAX_TOP_K = 100;
const MAX_QUERY_LENGTH = 4190;

type ProviderFilter = "" | "google_drive" | "dropbox";
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
  const [searchMode, setSearchMode] = useState<SearchMode>("semantic");
  const [sortBy, setSortBy] = useState<SortOrder>("relevance");
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

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
                  ? "describe what you're looking for..."
                  : "enter filename or extension (e.g. invoice.pdf)"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="search-bar-actions">
            <button
              ref={buttonRef}
              type="button"
              className={`config-btn ${showSettings ? "active" : ""}`}
              onClick={() => setShowSettings(!showSettings)}
              aria-label="Settings"
              title="Search Settings"
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
              Search
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
                      <option value="google_drive">Google Drive</option>
                      <option value="dropbox">Dropbox</option>
                    </select>
                  </div>
                </div>

                {searchMode === "semantic" && (
                  <div>
                    <label className="field" htmlFor="search-k">
                      Top K
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

      {state.kind === "submitting" && (
        <div className="results" aria-busy="true" aria-label="Loading search results">
          <h3>Searching...</h3>
          <ul className="list">
            {[1, 2, 3].map((i) => (
              <li key={i} className="skeleton-card">
                <div className="row-line" style={{ gap: "14px" }}>
                  <div className="skeleton-box" style={{ width: "42px", height: "42px", borderRadius: "8px", flexShrink: 0 }} />
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
            <h3 style={{ margin: 0 }}>Result</h3>
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
        </div>
      )}
    </section>
  );
}
