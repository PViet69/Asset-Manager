import { Spinner } from "../../components/ui/Spinner";
import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { AppShell } from "../../components/layout/AppShell";
import { Button } from "../../components/ui/Button";
import { Tabs, TabList, Tab, TabPanel } from "../../components/ui/Tabs";
import { AdminModelHealth } from "../../components/AdminModelHealth";
import { ModelUnavailableDialog } from "../../components/ModelUnavailableDialog";
import { useAdminSession } from "../auth/useAdminSession";
import { AdminLoginForm } from "../auth/AdminLoginForm";
import { useAdminDashboard } from "./useAdminDashboard";
import { useProviderItems } from "./useProviderItems";
import { useProviderSync } from "./useProviderSync";
import { useApprovedTags } from "./useApprovedTags";
import { AdminOverview } from "./AdminOverview";
import { AdminProviders } from "./AdminProviders";
import { SyncActivityPanel } from "./SyncActivityPanel";
import { ApprovedTagsPanel } from "./ApprovedTagsPanel";
import { ProviderItemsDialog } from "./ProviderItemsDialog";
import styles from "./AdminWorkspace.module.css";
export function AdminWorkspace(): JSX.Element {
  const session = useAdminSession();
  const enabled = session.status === "authenticated";
  const dashboard = useAdminDashboard({
    enabled,
    onUnauthorized: session.expire,
  });
  const [modelUnavailable, setModelUnavailable] = useState(false);
  function onError(error: unknown, fallback: string) {
    if (error instanceof ApiError && error.status === 401) {
      session.expire();
      setModelUnavailable(false);
    } else
      dashboard.notify(
        error instanceof ApiError ? error.message : fallback,
        "error",
      );
  }
  const common = { enabled, onError };
  const items = useProviderItems({
    ...common,
    onDeleted: () => {
      void dashboard.reload();
      dashboard.notify("Embedded item deleted.", "status");
    },
  });
  const tags = useApprovedTags({ ...common, notify: dashboard.notify });
  const sync = useProviderSync({
    ...common,
    onComplete: () => dashboard.reload(),
    onModelUnavailable: () => setModelUnavailable(true),
    onProgress: dashboard.addEmbeddedDelta,
    onStatus: (message) => dashboard.notify(message, "status"),
  });
  useEffect(() => {
    document.title = "Admin Dashboard";
  }, []);
  useEffect(() => {
    if (!enabled) setModelUnavailable(false);
  }, [enabled]);
  const controls = {
    refreshingProviders: dashboard.refreshingProviders,
    syncingProviders: sync.syncingProviders,
    stoppingProviders: sync.stoppingProviders,
    onRefresh: (id: string) => void dashboard.refreshProvider(id),
    onBrowse: (id: string) => void items.open(id),
    onStart: (id: string) => void sync.start(id),
    onStop: (id: string) => void sync.stop(id),
  };
  const providers = (
    <AdminProviders dashboard={dashboard.dashboard} controls={controls} isLoading={dashboard.isLoading} />
  );
  const activity = (
    <SyncActivityPanel
      providers={dashboard.dashboard.providers}
      activity={sync.activityByProvider}
    />
  );
  return (
    <AppShell activeArea="admin">
      <main className={styles.workspace}>
        {session.status === "checking" ? (
          <Spinner label="Checking admin session" />
        ) : !enabled ? (
          <AdminLoginForm session={session} />
        ) : (
          <>
            <header className={styles.header}>
              <div>
                <p>ADMINISTRATION</p>
                <h1>Workspace overview</h1>
              </div>
              {session.authRequired && <Button onPress={() => void session.logout()}>Sign out</Button>}
            </header>
            <Tabs defaultSelectedKey="overview" className={styles.tabs}>
              <TabList aria-label="Admin sections">
                {[
                  "Overview",
                  "Providers",
                  "Models",
                  "Activity",
                  "Settings",
                ].map((label) => (
                  <Tab id={label.toLowerCase()} key={label}>
                    {label}
                  </Tab>
                ))}
              </TabList>
              <TabPanel id="overview" className={styles.tabPanel}>
                <AdminOverview
                  dashboard={dashboard.dashboard}
                  isLoading={dashboard.isLoading}
                  onRefresh={() => void dashboard.reload()}
                />
                {providers}
                {activity}
              </TabPanel>
              <TabPanel id="providers" className={styles.tabPanel}>
                {providers}
                {activity}
              </TabPanel>
              <TabPanel id="models" className={styles.tabPanel}>
                <AdminModelHealth
                  embeddingModel={dashboard.dashboard.embeddingModel}
                  descriptionModel={dashboard.dashboard.descriptionModel}
                  videoModel={dashboard.dashboard.videoModel}
                  isLoading={dashboard.isLoading}
                />
              </TabPanel>
              <TabPanel id="activity" className={styles.tabPanel}>
                <SyncActivityPanel
                  providers={dashboard.dashboard.providers}
                  activity={sync.activityByProvider}
                  history
                />
              </TabPanel>
              <TabPanel id="settings" className={styles.tabPanel}>
                <ApprovedTagsPanel model={tags} />
              </TabPanel>
            </Tabs>
            <ProviderItemsDialog
              model={items}
              providers={dashboard.dashboard.providers}
            />
            {modelUnavailable && (
              <ModelUnavailableDialog
                onDismiss={() => setModelUnavailable(false)}
              />
            )}
            <div className={styles.notifications}>
              {dashboard.toasts.map((toast) => (
                <p
                  role={toast.type === "error" ? "alert" : "status"}
                  key={toast.id}
                >
                  {toast.message}
                </p>
              ))}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}
