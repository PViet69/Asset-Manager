import { lazy, Suspense } from "react";

import { SearchPanel } from "./components/SearchPanel";

const AdminPage = lazy(() =>
  import("./components/AdminPage").then(({ AdminPage: Page }) => ({ default: Page }))
);

export function App(): JSX.Element {
  const path = window.location.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) {
    return (
      <Suspense fallback={<div role="status" aria-label="Loading admin dashboard" />}>
        <AdminPage />
      </Suspense>
    );
  }
  document.title = "Asset Manager";
  return <MainPage />;
}

function MainPage(): JSX.Element {
  return (
    <div className="app">
      {/* Top Header Navigation */}
      <header className="search-navbar">
        <div className="search-navbar__inner">
          <div className="search-navbar__brand">
            <div className="search-navbar__logo" aria-hidden="true">
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 2L3 7l9 5 9-5-9-5z" />
                <path d="M3 12l9 5 9-5" />
                <path d="M3 17l9 5 9-5" />
              </svg>
            </div>
            <h1 className="search-navbar__title">Asset Manager</h1>
          </div>
        </div>
      </header>

      {/* Main Search Workspace */}
      <main className="search-main">
        <div className="search-hero">
          <h2 className="search-hero__title">
            Search Media
          </h2>
          <p className="search-hero__subtitle">
            Find media, across your storage providers using natural language queries or exact filename match.
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
    </div>
  );
}
