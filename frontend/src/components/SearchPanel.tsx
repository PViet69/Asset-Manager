import { useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { ApiError, searchVectors } from "../api/client";
import type { VectorSearchItem } from "../types";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

const DEFAULT_TOP_K = 10;
const MIN_TOP_K = 1;
const MAX_TOP_K = 100;

type ProviderFilter = "" | "google_drive" | "dropbox";
type SearchMode = "semantic" | "filename";

type SearchState =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "result"; items: VectorSearchItem[] }
  | { kind: "error"; message: string };

function formatScore(score: number): string {
  return score.toFixed(3);
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
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [state, setState] = useState<SearchState>({ kind: "idle" });

  useEffect(() => {
    if (searchMode !== "filename") return;

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

  return (
    <section className="glass panel-card" role="tabpanel">
      {externalTopK === undefined && (
        <div className="settings-wrapper">
          <button
            type="button"
            className="settings-btn"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Settings"
            title="Settings"
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
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          {showSettings && (
            <div className="settings-popover glass" role="dialog" aria-label="Settings popover">
              <div className="popover-header">
                <h3>Settings</h3>
                <button
                  type="button"
                  className="popover-close-btn"
                  onClick={() => setShowSettings(false)}
                  aria-label="Close settings"
                >
                  ✕
                </button>
              </div>
              <div className="field-group">
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
                <small className="field-hint">
                  Number of similarity search results for Semantic Search.
                </small>
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={onSubmit}>
        <div className="grid-2">
          <div>
            <label className="field" htmlFor="search-q">
              Query
            </label>
            <div className="input">
              <input
                id="search-q"
                type="text"
                placeholder={
                  searchMode === "semantic"
                    ? "describe what you're looking for"
                    : "enter filename or extension (e.g. invoice.pdf)"
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
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
        </div>

        <div className="actions" style={{ justifyContent: "flex-end" }}>
          <button
            className="primary"
            type="submit"
            disabled={state.kind === "submitting" || query.trim().length === 0}
          >
            Search
          </button>
        </div>
      </form>

      {state.kind === "error" && (
        <div className="banner" role="alert">
          {state.message}
        </div>
      )}

      {state.kind === "result" && (
        <div className="results">
          <h3>Result</h3>
          <ul className="list search-results--entering" aria-label="Search results">
            {state.items.map((item, index) => {
              const sourceUrl = item.source_url ?? null;
              const animationStyle = { "--result-index": index } as CSSProperties;
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
                    <span className="score">{formatScore(item.score)}</span>
                  </div>
                  <div className="snippet">{item.content}</div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
