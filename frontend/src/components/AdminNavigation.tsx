export type AdminTab = "dashboards" | "providers" | "models" | "logs" | "settings";

export interface AdminNavigationProps {
  readonly activeTab: AdminTab;
  readonly isMobileOpen: boolean;
  readonly onSelectTab: (tab: AdminTab) => void;
  readonly onCloseMobile: () => void;
}

interface TabDef {
  readonly id: AdminTab;
  readonly label: string;
  readonly icon: JSX.Element;
}

const tabs: readonly TabDef[] = [
  {
    id: "dashboards",
    label: "Overview",
    icon: (
      <svg className="admin-navigation__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    id: "providers",
    label: "Providers",
    icon: (
      <svg className="admin-navigation__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        <line x1="12" y1="11" x2="12" y2="17" />
        <line x1="9" y1="14" x2="15" y2="14" />
      </svg>
    ),
  },
  {
    id: "models",
    label: "Models",
    icon: (
      <svg className="admin-navigation__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.5V14h-4V9.5C8.8 8.8 8 7.5 8 6a4 4 0 0 1 4-4z" />
        <path d="M9 18h6" />
        <path d="M10 22h4" />
      </svg>
    ),
  },
  {
    id: "logs",
    label: "Activity",
    icon: (
      <svg className="admin-navigation__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    ),
  },
  {
    id: "settings",
    label: "Settings",
    icon: (
      <svg className="admin-navigation__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

interface AdminTabListProps {
  readonly activeTab: AdminTab;
  readonly onSelectTab: (tab: AdminTab) => void;
}

function AdminTabList({ activeTab, onSelectTab }: AdminTabListProps): JSX.Element {
  return (
    <div className="admin-navigation__list">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`admin-navigation__item ${activeTab === tab.id ? "admin-navigation__item--active" : ""}`}
          onClick={() => onSelectTab(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

export function AdminNavigation({ activeTab, isMobileOpen, onSelectTab, onCloseMobile }: AdminNavigationProps): JSX.Element {
  return (
    <>
      <nav className="admin-sidebar" aria-label="Admin navigation">
        <div className="admin-sidebar__brand">Asset Manager</div>
        <AdminTabList activeTab={activeTab} onSelectTab={onSelectTab} />
      </nav>
      {isMobileOpen ? (
        <div className="admin-mobile-nav" role="dialog" aria-label="Admin navigation" aria-modal="true">
          <div className="admin-mobile-nav__backdrop" onClick={onCloseMobile} aria-hidden="true" />
          <nav className="admin-mobile-nav__panel" aria-label="Admin navigation">
            <div className="admin-mobile-nav__header">
              <strong>Asset Manager</strong>
              <button type="button" className="admin-icon-button" onClick={onCloseMobile} aria-label="Close navigation">
                Close
              </button>
            </div>
            <AdminTabList activeTab={activeTab} onSelectTab={onSelectTab} />
          </nav>
        </div>
      ) : null}
    </>
  );
}
