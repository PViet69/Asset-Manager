import { useState } from "react";
import { AdminPage } from "./components/AdminPage";
import { SearchPanel } from "./components/SearchPanel";

export function App(): JSX.Element {
  const path = window.location.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) return <AdminPage />;
  document.title = "Asset Manager";
  return <MainPage />;
}

function MainPage(): JSX.Element {
  const [sidePanelOpen, setSidePanelOpen] = useState<boolean>(false);

  return (
    <div className="app">
      {/* Top Header Navigation */}
      <header className="search-navbar">
        <div className="search-navbar__inner">
          <button
            type="button"
            className="search-navbar__brand-btn"
            onClick={() => setSidePanelOpen(true)}
            aria-label="Open Asset Manager menu"
            aria-expanded={sidePanelOpen}
          >
            <div className="search-navbar__logo" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ffffff"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "18px", height: "18px" }}
              >
                <path d="M12 2L3 7l9 5 9-5-9-5z" />
                <path d="M3 12l9 5 9-5" />
                <path d="M3 17l9 5 9-5" />
              </svg>
            </div>
            <div className="search-navbar__title-group">
              <h1 className="search-navbar__title">Asset Manager</h1>
              <span className="search-navbar__badge">Vector AI</span>
            </div>
          </button>

          <div className="search-navbar__actions">
            <a
              href="/admin"
              className="search-navbar__admin-btn"
              title="Open Admin Dashboard"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="7" height="9" rx="1" />
                <rect x="14" y="3" width="7" height="5" rx="1" />
                <rect x="14" y="12" width="7" height="9" rx="1" />
                <rect x="3" y="16" width="7" height="5" rx="1" />
              </svg>
              <span>Admin Portal</span>
            </a>
          </div>
        </div>
      </header>

      {/* Main Search Workspace */}
      <main className="search-main">
        <div className="search-hero">
          <div className="search-hero__eyebrow">
            <span className="search-hero__dot" aria-hidden="true" />
            <span>Semantic Vector Search</span>
          </div>
          <h2 className="search-hero__title">
            Search Assets &amp; Documents
          </h2>
          <p className="search-hero__subtitle">
            Find documents, media, and records across your storage providers using natural language queries or exact filename match.
          </p>
        </div>

        {/* Core Functional Search Interface */}
        <SearchPanel />
      </main>

      {/* Footer */}
      <footer className="search-footer">
        <div>
          <span>© {new Date().getFullYear()} Asset Manager · Powered by Qdrant &amp; Vector Embeddings</span>
        </div>
      </footer>

      {/* Side Panel Drawer */}
      {sidePanelOpen && (
        <>
          <div
            className="side-panel-backdrop"
            onClick={() => setSidePanelOpen(false)}
            aria-hidden="true"
          />
          <aside className="side-panel-drawer" aria-label="Asset Manager side navigation panel">
            <div className="side-panel-header">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div className="brand-icon" style={{ width: "28px", height: "28px", borderRadius: "8px" }} aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#05070c"
                    strokeWidth={2.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ width: "16px", height: "16px" }}
                  >
                    <path d="M12 2L3 7l9 5 9-5-9-5z" />
                    <path d="M3 12l9 5 9-5" />
                    <path d="M3 17l9 5 9-5" />
                  </svg>
                </div>
                <strong style={{ fontSize: "15px", fontWeight: 700 }}>Asset Manager</strong>
              </div>
              <button
                type="button"
                className="side-panel-close-btn"
                onClick={() => setSidePanelOpen(false)}
                aria-label="Close side panel"
              >
                ✕
              </button>
            </div>

            <div className="side-panel-content">
              <a
                href="/admin"
                className="admin-sidebar__tab"
                style={{ textDecoration: "none" }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="9" rx="1" />
                  <rect x="14" y="3" width="7" height="5" rx="1" />
                  <rect x="14" y="12" width="7" height="9" rx="1" />
                  <rect x="3" y="16" width="7" height="5" rx="1" />
                </svg>
                <span>Dashboards</span>
              </a>

              <a
                href="/admin"
                className="admin-sidebar__tab"
                style={{ textDecoration: "none" }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  <line x1="12" y1="11" x2="12" y2="17" />
                  <line x1="9" y1="14" x2="15" y2="14" />
                </svg>
                <span>Providers</span>
              </a>

              <a
                href="/admin"
                className="admin-sidebar__tab"
                style={{ textDecoration: "none" }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V14h-4V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z" />
                  <path d="M9 18h6" />
                  <path d="M10 22h4" />
                </svg>
                <span>Models</span>
              </a>

              <a
                href="/admin"
                className="admin-sidebar__tab"
                style={{ textDecoration: "none" }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>Logs</span>
              </a>

              <a
                href="/admin"
                className="admin-sidebar__tab"
                style={{ textDecoration: "none" }}
              >
                <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>Settings</span>
              </a>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
