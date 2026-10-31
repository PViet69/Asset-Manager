import { Spinner } from "../../components/ui/Spinner";
import type { VectorSearchItem } from "../../types";
import type { SearchState } from "./search.types";
import { SearchResultCard } from "./SearchResultCard";
import styles from "./SearchResults.module.css";
export function SearchResults({
  state,
  items,
  showScore = true,
  onProviderChange,
}: {
  state: SearchState;
  items: readonly VectorSearchItem[];
  showScore?: boolean;
  onProviderChange?(provider: string): void;
}) {
  if (state.kind === "idle")
    return (
      <div className={styles.message}>
        <h2>Find your next asset</h2>
        <p>Describe an asset or search by filename.</p>
      </div>
    );
  if (state.kind === "submitting")
    return (
      <div className={styles.message} aria-busy="true">
        <Spinner label="Searching assets" />
      </div>
    );
  if (state.kind === "error")
    return state.message === "Model not found" ? null : (
      <p className={styles.error} role="alert">
        {state.message}
      </p>
    );
  if (!items.length)
    return (
      <div className={styles.message}>
        <h2>No matching assets found</h2>
        <p>Try different keywords or remove filters.</p>
      </div>
    );
  return (
    <ul className={styles.grid} aria-label="Search results">
      {items.map((item) => (
        <li key={item.point_id}>
          <SearchResultCard
            item={item}
            showScore={showScore}
            onProviderChange={onProviderChange}
          />
        </li>
      ))}
    </ul>
  );
}
