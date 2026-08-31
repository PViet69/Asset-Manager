import { useState } from "react";
import { AdminPage } from "./components/AdminPage";
import { SearchPanel } from "./components/SearchPanel";

export function App(): JSX.Element {
  if (window.location.pathname === "/admin") return <AdminPage />;
  document.title = "Asset Manager";
  return <MainPage />;
}

function MainPage(): JSX.Element {
  const [topK, setTopK] = useState<string>("10");
  const [showSettings, setShowSettings] = useState<boolean>(false);

  return (
    <div className="app">
      <header className="bar">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="#0a0d14"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L3 7l9 5 9-5-9-5z" />
              <path d="M3 12l9 5 9-5" />
              <path d="M3 17l9 5 9-5" />
            </svg>
          </div>
          <div>
            <h1>Asset Manager</h1>
          </div>
        </div>

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
                    min={1}
                    max={100}
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
      </header>

      <main className="app-content">
        <div className="page-header" style={{ marginBottom: "20px" }}>
          <h2 style={{ fontSize: "22px", fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
            Search Assets
          </h2>
          <p style={{ color: "var(--text-dim)", margin: "4px 0 0 0", fontSize: "14px" }}>
            Explore and locate files using AI semantic search or filename matching
          </p>
        </div>
        <SearchPanel externalTopK={topK} onTopKChange={setTopK} />
      </main>
    </div>
  );
}
