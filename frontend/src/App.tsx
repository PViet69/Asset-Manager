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
  return (
    <div className="app">
      {/* Floating Island Navigation */}
      <div className="floating-nav-container">
        <header className="floating-nav-pill">
          <a href="/" className="floating-nav-brand">
            <div className="brand-icon" aria-hidden="true">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="#05070c"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ width: "20px", height: "20px" }}
              >
                <path d="M12 2L3 7l9 5 9-5-9-5z" />
                <path d="M3 12l9 5 9-5" />
                <path d="M3 17l9 5 9-5" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: "16px", fontWeight: 700, margin: 0 }}>Asset Manager</h1>
            </div>
          </a>

        </header>
      </div>

      {/* High-End Functional Workspace Container */}
      <main style={{ maxWidth: "1140px", margin: "0 auto", padding: "0 20px 60px" }}>
        <div className="double-bezel-outer">
          <div className="double-bezel-inner">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <div className="eyebrow-badge" style={{ marginBottom: "8px" }}>SEMANTIC SEARCH WORKSPACE</div>
                <h2 style={{ fontSize: "24px", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
                  Search Assets &amp; File Embeddings
                </h2>
                <p style={{ color: "var(--text-dim)", margin: "6px 0 0 0", fontSize: "14px" }}>
                  Locate images, PDFs, and documents using natural language queries or filename matching
                </p>
              </div>
            </div>

            {/* Core Functional Search Interface */}
            <SearchPanel />
          </div>
        </div>
      </main>

      {/* Floating Footer */}
      <footer style={{ maxWidth: "1140px", margin: "20px auto 0", padding: "0 24px", textAlign: "center" }}>
        <div style={{ padding: "20px 0", borderTop: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            © {new Date().getFullYear()} Asset Manager. All rights reserved.
          </div>
          <div style={{ display: "flex", gap: "16px", fontSize: "13px" }}>
            <a href="/health" style={{ color: "var(--text-dim)", textDecoration: "none" }}>Health Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
