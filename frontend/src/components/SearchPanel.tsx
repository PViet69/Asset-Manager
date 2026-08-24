import { useState, type FormEvent } from "react";
import { ApiError, searchVectors } from "../api/client";
import type { VectorSearchItem } from "../types";

const DEFAULT_TOP_K = 10;
const MIN_TOP_K = 1;
const MAX_TOP_K = 100;

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

export function SearchPanel(): JSX.Element {
  const [query, setQuery] = useState<string>("");
  const [topK, setTopK] = useState<string>(String(DEFAULT_TOP_K));
  const [state, setState] = useState<SearchState>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    setState({ kind: "submitting" });
    try {
      const res = await searchVectors(trimmed, clampTopK(topK));
      setState({ kind: "result", items: res.data });
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Search failed";
      setState({ kind: "error", message });
    }
  }

  return (
    <section className="glass panel-card" role="tabpanel">
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
                placeholder="describe what you're looking for"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
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
          <h3>Hits</h3>
          <ul className="list">
            {state.items.map((item) => {
              const sourceUrl = item.source_url ?? null;
              return (
                <li key={item.point_id}>
                  <div className="row-line">
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
                          📄 {item.filename} <span style={{ fontSize: "11px" }}>↗</span>
                        </a>
                      ) : (
                        <span className="fname" title={item.filename}>
                          📄 {item.filename}
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
