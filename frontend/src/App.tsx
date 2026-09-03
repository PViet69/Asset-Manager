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
        <SearchPanel />
      </main>
    </div>
  );
}
