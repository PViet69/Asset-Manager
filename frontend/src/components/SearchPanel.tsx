import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { createPortal } from "react-dom";
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

type SearchMode = "semantic" | "filename";

function displayTag(tag?: string): string {
  if (!tag) return "";
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
  const [draftProvider, setDraftProvider] = useState<ProviderFilter>("");
  const [providers, setProviders] = useState<readonly ProviderMeta[]>([]);
  const [tagGroups, setTagGroups] = useState<readonly TagGroup[]>([]);
  const [selectedTags, setSelectedTags] = useState<readonly string[]>([]);
  const [draftTags, setDraftTags] = useState<readonly string[]>([]);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [isProviderDropdownOpen, setIsProviderDropdownOpen] = useState(false);
  const [isTagsDropdownOpen, setIsTagsDropdownOpen] = useState(false);
  const providerDropdownRef = useRef<HTMLDivElement>(null);
  const tagsDropdownRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!isProviderDropdownOpen && !isTagsDropdownOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        isProviderDropdownOpen &&
        providerDropdownRef.current &&
        !providerDropdownRef.current.contains(event.target as Node)
      ) {
        setIsProviderDropdownOpen(false);
      }
      if (
        isTagsDropdownOpen &&
        tagsDropdownRef.current &&
        !tagsDropdownRef.current.contains(event.target as Node)
      ) {
        setIsTagsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isProviderDropdownOpen, isTagsDropdownOpen]);

  function toggleTag(tag: string): void {
    setDraftTags((current) =>
      current.includes(tag)
        ? current.filter((selected) => selected !== tag)
        : [...current, tag]
    );
  }

  function openTagPicker(): void {
    setDraftTags(selectedTags);
    setDraftProvider(provider);
    setIsProviderDropdownOpen(false);
    setIsTagsDropdownOpen(false);
    setIsTagPickerOpen(true);
  }

  function closeTagPicker(): void {
    setIsTagPickerOpen(false);
  }

  function confirmTagPicker(): void {
    setSelectedTags(draftTags);
    setProvider(draftProvider);
    setIsTagPickerOpen(false);
    if (state.kind === "result" || state.kind === "submitting") {
      void performSearch(query, draftProvider, searchMode, draftTags);
    }
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
    if (searchMode === "semantic") setSortBy("relevance");
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
          "filename",
          ...(selectedTags.length > 0 ? [[...selectedTags]] : [])
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
  }, [query, provider, searchMode, selectedTags]);

  async function performSearch(
    targetQuery: string,
    targetProvider: ProviderFilter,
    targetMode: SearchMode,
    targetTags: readonly string[]
  ): Promise<void> {
    if (targetQuery.length > MAX_QUERY_LENGTH) return;
    const trimmed = targetQuery.trim();
    if (trimmed.length === 0) return;

    const reqId = ++searchRequestIdRef.current;
    setState({ kind: "submitting" });
    try {
      const args = [
        trimmed,
        targetMode === "semantic" ? clampTopK(topK) : MAX_TOP_K,
        targetProvider || undefined,
        targetMode,
      ] as const;
      const res = targetTags.length > 0
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
      void performSearch(query, nextProvider, searchMode, selectedTags);
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
      </div>

      <form onSubmit={onSubmit}>
        <div className="search-bar-box">
          <div className="search-input-wrapper">
            <button
              type="submit"
              className="search-bar-submit-btn"
              aria-label="Search"
              title="Search"
            >
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
            </button>

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

          <div className="search-bar-actions">
            <button
              type="button"
              className={`search-filter-btn ${isTagPickerOpen ? "search-filter-btn--active" : ""} ${selectedTags.length > 0 || Boolean(provider) ? "search-filter-btn--has-filters" : ""}`}
              aria-label="Tag filters"
              aria-expanded={isTagPickerOpen}
              aria-controls="tag-filter-picker"
              onClick={() => (isTagPickerOpen ? closeTagPicker() : openTagPicker())}
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
              </svg>
            </button>
          </div>

          {isTagPickerOpen && createPortal(
            <div
              className="search-tag-modal-backdrop"
              onClick={closeTagPicker}
            >
              <div
                id="tag-filter-picker"
                className="search-tag-picker search-tag-picker--modal"
                role="dialog"
                aria-modal="true"
                aria-label="Filter by tags"
                onClick={(event) => event.stopPropagation()}
              >
        <div className="search-tag-picker__header">
          <div className="search-tag-picker__title-group">
            <span className="search-tag-picker__title">Filter</span>
          </div>
          <button
            type="button"
            className="search-tag-picker__close-btn"
            onClick={closeTagPicker}
            aria-label="Close filter window"
            title="Close"
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
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        {(draftTags.length > 0 || Boolean(draftProvider)) && (
          <div className="search-tag-selected-tray" aria-label="Selected tags">
            <span className="search-tag-selected-tray__label">Selected:</span>
            <span
              className="search-tag-picker__badge"
              aria-label={`${draftTags.length + (draftProvider ? 1 : 0)} selected`}
            >
              {draftTags.length + (draftProvider ? 1 : 0)}
            </span>
            <div className="search-tag-selected-tray__chips">
              {draftProvider && (
                <span key={draftProvider} className="search-tag-selected-chip">
                  <ProviderLogo provider={draftProvider} size={12} />
                  <span>{providers.find((p) => p.id === draftProvider)?.displayName ?? draftProvider}</span>
                  <button
                    type="button"
                    className="search-tag-selected-chip__remove"
                    onClick={() => setDraftProvider("")}
                    aria-label={`Remove provider filter ${draftProvider}`}
                  >
                    ✕
                  </button>
                </span>
              )}
              {draftTags.map((tag) => (
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
        <div className="search-filter-dialog-body">
          {providers.length > 0 && (
            <div className="search-filter-row">
              <span className="search-filter-row__label" id="filter-provider-label">
                Provider
              </span>
              <div className="search-filter-row__control" ref={providerDropdownRef}>
                <div className="gdrive-select-container">
                  <button
                    type="button"
                    id="filter-provider-select"
                    aria-labelledby="filter-provider-label"
                    aria-haspopup="listbox"
                    aria-expanded={isProviderDropdownOpen}
                    className={`gdrive-select-trigger ${isProviderDropdownOpen ? "gdrive-select-trigger--open" : ""}`}
                    onClick={() => setIsProviderDropdownOpen((open) => !open)}
                  >
                    <span className="gdrive-select-trigger__value">
                      {draftProvider ? (
                        <>
                          <ProviderLogo provider={draftProvider} size={18} />
                          <span>{providers.find((p) => p.id === draftProvider)?.displayName ?? draftProvider}</span>
                        </>
                      ) : (
                        <>
                          <span className="gdrive-select-item__icon-spacer" />
                          <span>Any</span>
                        </>
                      )}
                    </span>
                    <span className="gdrive-select-trigger__caret">
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                        {isProviderDropdownOpen ? (
                          <path d="M0 6L5 0L10 6H0Z" />
                        ) : (
                          <path d="M0 0L5 6L10 0H0Z" />
                        )}
                      </svg>
                    </span>
                  </button>

                  {isProviderDropdownOpen && (
                    <div className="gdrive-select-menu" role="listbox" aria-labelledby="filter-provider-label">
                      <button
                        type="button"
                        role="option"
                        aria-selected={draftProvider === ""}
                        className={`gdrive-select-item ${draftProvider === "" ? "gdrive-select-item--selected" : ""}`}
                        onClick={() => {
                          setDraftProvider("");
                          setIsProviderDropdownOpen(false);
                        }}
                      >
                        <span className="gdrive-select-item__icon-spacer" />
                        <span>Any</span>
                      </button>
                      {providers.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          role="option"
                          aria-selected={draftProvider === p.id}
                          className={`gdrive-select-item ${draftProvider === p.id ? "gdrive-select-item--selected" : ""}`}
                          onClick={() => {
                            setDraftProvider(p.id as ProviderFilter);
                            setIsProviderDropdownOpen(false);
                          }}
                        >
                          <ProviderLogo provider={p.id} size={18} />
                          <span>{p.displayName}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tagGroups.length === 0 ? (
            providers.length === 0 ? (
              <div className="search-tag-picker__empty">
                <span className="hint">No filters are available.</span>
              </div>
            ) : null
          ) : (
            <div className="search-filter-row search-filter-row--tags">
              <span className="search-filter-row__label" id="filter-tags-label">
                Tags
              </span>
              <div className="search-filter-row__control" ref={tagsDropdownRef}>
                <div className="gdrive-select-container">
                  <button
                    type="button"
                    id="filter-tags-select"
                    aria-labelledby="filter-tags-label"
                    aria-haspopup="listbox"
                    aria-expanded={isTagsDropdownOpen}
                    className={`gdrive-select-trigger ${isTagsDropdownOpen ? "gdrive-select-trigger--open" : ""}`}
                    onClick={() => setIsTagsDropdownOpen((open) => !open)}
                  >
                    <span className="gdrive-select-trigger__value">
                      {draftTags.length === 0 ? (
                        <>
                          <span className="gdrive-select-item__icon-spacer" />
                          <span>Any</span>
                        </>
                      ) : draftTags.length === 1 ? (
                        <>
                          <span className="gdrive-select-item__tag-icon">🏷️</span>
                          <span>{displayTag(draftTags[0])}</span>
                        </>
                      ) : (
                        <>
                          <span className="gdrive-select-item__tag-icon">🏷️</span>
                          <span>{draftTags.length} tags selected</span>
                        </>
                      )}
                    </span>
                    <span className="gdrive-select-trigger__caret">
                      <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden="true">
                        {isTagsDropdownOpen ? (
                          <path d="M0 6L5 0L10 6H0Z" />
                        ) : (
                          <path d="M0 0L5 6L10 0H0Z" />
                        )}
                      </svg>
                    </span>
                  </button>

                  {isTagsDropdownOpen && (
                    <div className="gdrive-select-menu gdrive-select-menu--tags" role="listbox" aria-labelledby="filter-tags-label">
                      <button
                        type="button"
                        role="option"
                        aria-selected={draftTags.length === 0}
                        className={`gdrive-select-item ${draftTags.length === 0 ? "gdrive-select-item--selected" : ""}`}
                        onClick={() => {
                          setDraftTags([]);
                          setIsTagsDropdownOpen(false);
                        }}
                      >
                        <span className="gdrive-select-item__icon-spacer" />
                        <span>Any</span>
                      </button>

                      {tagGroups.map((group) => (
                        <div key={group.category} className="gdrive-select-group">
                          <div className="gdrive-select-group__title">
                            {group.category}
                          </div>
                          {group.tags.map((tag) => {
                            const isSelected = draftTags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                role="option"
                                aria-selected={isSelected}
                                className={`gdrive-select-item ${isSelected ? "gdrive-select-item--selected" : ""}`}
                                onClick={() => toggleTag(tag)}
                              >
                                <span className="gdrive-select-item__check">
                                  {isSelected ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  ) : (
                                    <span className="gdrive-select-item__check-placeholder" />
                                  )}
                                </span>
                                <span>{displayTag(tag)}</span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="search-tag-picker__footer">
          <button
            type="button"
            className="search-tag-picker__clear-btn"
            onClick={() => {
              setDraftTags([]);
              setDraftProvider("");
            }}
            disabled={draftTags.length === 0 && draftProvider === ""}
          >
            Reset
          </button>
          <button
            type="button"
            className="search-tag-picker__confirm-btn"
            onClick={confirmTagPicker}
          >
            Confirm
          </button>
        </div>
              </div>
            </div>,
            document.body
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
                  ? "Try using different keywords, broadening description, or removing tag filters."
                  : "Check filename spelling, remove tag filters, or switch to Semantic Search."}
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
