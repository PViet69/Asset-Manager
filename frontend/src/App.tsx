import { SearchPanel } from "./components/SearchPanel";

export function App(): JSX.Element {
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
            <h1>Embedding UI</h1>
            <div className="sub">OpenAI-compatible · quick tester</div>
          </div>
        </div>
      </header>

      <SearchPanel />
    </div>
  );
}
