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
      isRefreshing={false}
      isSyncing={false}
      isItemsLoading={false}
      onRefresh={vi.fn()}
      onOpenItems={vi.fn()}
      onSync={vi.fn()}
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

test("enables stop while provider prepares or indexes a file", () => {
  renderCard({ isSyncing: true });

  const card = screen.getByRole("article", { name: "Google Drive provider" });
  expect(card).toHaveTextContent("Syncing");
  expect(screen.getByRole("button", { name: "Stop syncing Google Drive" })).toBeEnabled();
  expect(card.querySelector(".admin-provider-card__details")).not.toBeInTheDocument();
  expect(card.querySelector(".admin-activity-list")).not.toBeInTheDocument();
});

