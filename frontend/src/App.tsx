import { lazy, Suspense } from "react";

import { AppShell } from "./components/layout/AppShell";
import styles from "./App.module.css";

import { SearchPanel } from "./components/SearchPanel";

const AdminPage = lazy(() =>
  import("./components/AdminPage").then(({ AdminPage: Page }) => ({
    default: Page,
  })),
);

export function App(): JSX.Element {
  const path = window.location.pathname;
  if (path === "/admin" || path.startsWith("/admin/")) {
    return (
      <Suspense
        fallback={<div role="status" aria-label="Loading admin dashboard" />}
      >
        <AdminPage />
      </Suspense>
    );
  }
  document.title = "Asset Manager";
  return <MainPage />;
}

function MainPage(): JSX.Element {
  return (
    <AppShell activeArea="search">
      <main className={styles.main}>
        <header className={styles.heading}>
          <h1>Find your next asset.</h1>
          <p>Search across your connected libraries.</p>
        </header>
        <SearchPanel />
      </main>
    </AppShell>
  );
}
