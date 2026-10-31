import { ProgressBar } from "react-aria-components";
import styles from "./Spinner.module.css";

export function Spinner({ label = "Loading", small = false }: { label?: string; small?: boolean }): JSX.Element {
  return (
    <ProgressBar aria-label={label} isIndeterminate className={`${styles.spinner} ${small ? styles.small : ""}`}>
      <svg className={styles.ring} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false">
        <circle className={styles.track} cx="16" cy="16" r="12" strokeWidth="3" />
        <circle className={styles.arc} cx="16" cy="16" r="12" strokeWidth="3" strokeLinecap="round" strokeDasharray="24 76" pathLength="100" />
      </svg>
    </ProgressBar>
  );
}
