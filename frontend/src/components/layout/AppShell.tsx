import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import styles from "./AppShell.module.css";

export function AppShell({
  activeArea,
  children,
}: {
  activeArea: "search" | "admin";
  children: ReactNode;
}): JSX.Element {
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    if (activeArea === "admin") window.scrollTo(0, 0);
  }, [activeArea]);
  const links = (
    <>
      <a href="/" aria-current={activeArea === "search" ? "page" : undefined}>
        Asset search
      </a>
      <a
        href="/admin"
        aria-current={activeArea === "admin" ? "page" : undefined}
      >
        Administration
      </a>
    </>
  );
  return (
    <div className={styles.shell} data-area={activeArea}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="/">
          <img className={styles.mark} src="/favicon.svg" alt="" />
          Asset Manager
        </a>
        <nav aria-label="Main navigation" className={styles.navigation}>
          {links}
        </nav>
      </aside>
      <header className={styles.mobileHeader}>
        <a className={styles.brand} href="/">
          <img className={styles.mark} src="/favicon.svg" alt="" />
          Asset Manager
        </a>
        <Button onPress={() => setOpen(true)} aria-label="Open navigation">
          Menu
        </Button>
      </header>
      <Dialog isOpen={isOpen} onOpenChange={setOpen} title="Navigation">
        <nav
          aria-label="Mobile navigation"
          className={styles.navigation}
          onClick={() => setOpen(false)}
        >
          {links}
        </nav>
        <Button onPress={() => setOpen(false)}>Close navigation</Button>
      </Dialog>
      <div className={styles.content}>{children}</div>
    </div>
  );
}
