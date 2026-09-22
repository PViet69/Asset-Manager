import "@testing-library/jest-dom/vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  cleanup();
});

import { AdminProviderCard } from "./AdminProviderCard";

const styles = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const DANGLING_DISABLED_SELECTOR = /\.admin-primary-button:disabled,\s*\.admin-icon-button:disabled,\s*\/\*/s;
const ADMIN_SHELL_RULE = /\.admin-shell\s*\{[^}]*min-height:\s*100dvh;/s;

function adminShellRule(stylesheet: string): string {
  return stylesheet.match(ADMIN_SHELL_RULE)?.[0] ?? "";
}

const provider = {
  provider: "google_drive",
  display_name: "Google Drive",
  enabled: true,
  health: "ok",
  detected_count: 20,
  embedded_count: 18,
};

function renderCard(overrides: Partial<React.ComponentProps<typeof AdminProviderCard>> = {}): void {
  render(
    <AdminProviderCard
      provider={provider}
      events={[]}
      isRefreshing={false}
      isSyncing={false}
      isItemsLoading={false}
      isActivityOpen={false}
      onRefresh={vi.fn()}
      onOpenItems={vi.fn()}
      onSync={vi.fn()}
      onToggleActivity={vi.fn()}
      {...overrides}
    />
  );
}

test("shows index counts and actions for enabled provider", () => {
  renderCard();

  expect(screen.getByRole("article", { name: "Google Drive provider" })).toHaveTextContent("18 / 20");
  expect(screen.getByRole("button", { name: "Sync Google Drive" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "View embedded items for Google Drive" })).toBeEnabled();
});

test("keeps disabled refresh control separate from workspace layout", () => {
  expect(styles).not.toMatch(DANGLING_DISABLED_SELECTOR);
  expect(adminShellRule(styles)).toContain("min-height: 100dvh;");
});
test("hides percentage and embedded numbers and labels while refreshing", () => {
  renderCard({ isRefreshing: true });

  const card = screen.getByRole("article", { name: "Google Drive provider" });
  expect(card.querySelector(".admin-provider-ring")).toHaveClass("admin-provider-ring--spinning");
  expect(card.querySelector(".admin-provider-ring span")).toHaveTextContent("");
  expect(card.querySelector(".admin-provider-card__metric strong")).toHaveTextContent("");
  expect(card.querySelector(".admin-provider-card__metric span")).toHaveTextContent("");
});

test("shows current file and detailed sync event feed while syncing", () => {
  renderCard({
    isSyncing: true,
    isActivityOpen: true,
    events: [
      { sequence: 3, provider: "google_drive", filename: "brief.pdf", status: "embedding", detail: "Creating embedding", terminal: false },
      { sequence: 2, provider: "google_drive", filename: "archive.pdf", status: "done", detail: "Indexed", terminal: false },
      { sequence: 1, provider: "google_drive", filename: "broken.pdf", status: "failed", detail: "File unreadable", terminal: false },
    ],
  });

  const activity = screen.getByRole("region", { name: "Google Drive sync activity" });
  expect(activity).toHaveTextContent("Syncing brief.pdf");
  expect(activity).toHaveTextContent("Creating embedding");
  expect(activity).toHaveTextContent("archive.pdf");
  expect(activity).toHaveTextContent("Indexed");
  expect(activity).toHaveTextContent("broken.pdf");
  expect(activity).toHaveTextContent("File unreadable");
});

