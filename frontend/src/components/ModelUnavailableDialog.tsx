import { createPortal } from "react-dom";

export type ModelUnavailableDialogProps = {
  readonly onDismiss: () => void;
};

export function ModelUnavailableDialog({
  onDismiss,
}: ModelUnavailableDialogProps): JSX.Element {
  return createPortal(
    <div
      role="presentation"
      onClick={onDismiss}
      className="search-error-backdrop"
    >
      <div
        role="alert"
        aria-modal="true"
        aria-labelledby="semantic-search-error-title"
        aria-describedby="semantic-search-error-message"
        onClick={(event) => event.stopPropagation()}
        className="search-error-popup"
      >
        <div className="search-error-header">
          <div className="search-error-icon-box" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 id="semantic-search-error-title">Service Unavailable</h2>
        </div>
        <p id="semantic-search-error-message">Model not found</p>
        <div className="search-error-actions">
          <button
            type="button"
            className="search-error-dismiss"
            aria-label="Dismiss search error"
            onClick={onDismiss}
          >
            <span>Dismiss</span>
            <svg
              className="search-error-dismiss__icon"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
