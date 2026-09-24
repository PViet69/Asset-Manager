import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { AdminSyncActivityPanel } from "./AdminSyncActivityPanel";

afterEach(() => {
  cleanup();
});

const providers = [
  { provider: "google_drive", display_name: "Google Drive", enabled: true, health: "ok", detected_count: 20, embedded_count: 18 },
  { provider: "dropbox", display_name: "Dropbox", enabled: true, health: "ok", detected_count: 3, embedded_count: 2 },
];

test("renders session sync history grouped in provider order", () => {
  render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        dropbox: [
          { sequence: 3, provider: "dropbox", filename: null, status: "failed", detail: "File unreadable", terminal: false },
        ],
        google_drive: [
          { sequence: 2, provider: "google_drive", filename: "campaign.pdf", status: "indexing", detail: "Creating embedding", terminal: false },
          { sequence: 1, provider: "google_drive", filename: "archive.pdf", status: "indexed", detail: "Indexed", terminal: false },
        ],
      }}
    />
  );

  const panel = screen.getByRole("region", { name: "Sync activity" });
  expect(panel).toHaveAttribute("aria-live", "polite");
  expect(panel).toHaveTextContent("Indexing");
  expect(panel).toHaveTextContent("Indexed");
  expect(panel).toHaveTextContent("Failed");
  expect(panel).toHaveTextContent("Provider sync");
  expect(screen.queryByText("File unreadable")).toBeNull();
  expect(screen.queryByText("Creating embedding")).toBeNull();
  expect(screen.queryByText("2 providers")).toBeNull();

  expect(screen.queryByRole("heading", { level: 3 })).not.toBeInTheDocument();

  const cards = screen.getAllByRole("article");
  expect(cards.map((card) => card.getAttribute("aria-label"))).toEqual([
    "Google Drive campaign.pdf",
    "Google Drive archive.pdf",
    "Dropbox Provider sync",
  ]);

  const driveCard = screen.getByRole("article", { name: "Google Drive campaign.pdf" });
  const dropboxCard = screen.getByRole("article", { name: "Dropbox Provider sync" });
  expect(driveCard).toHaveClass("admin-sync-file-card--google-drive", "admin-sync-file-card--active");
  expect(driveCard.querySelector(".admin-sync-file-card__filename")?.textContent).toBe("campaign.pdf");
  expect(driveCard.querySelector(".admin-sync-file-card__provider")?.textContent).toContain("Google Drive");
  expect(dropboxCard).toHaveClass("admin-sync-file-card--dropbox");
  expect(dropboxCard).toHaveTextContent("Dropbox");
  expect(dropboxCard).not.toHaveClass("admin-sync-file-card--active");
  expect(driveCard).toHaveClass("admin-sync-file-card--entering");
});

test("renders stopped activity as a red stopped card", () => {
  render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        google_drive: [
          { sequence: 1, provider: "google_drive", filename: "campaign.pdf", status: "stopped", detail: "Stopped by administrator", terminal: false },
        ],
      }}
    />
  );

  const card = screen.getByRole("article", { name: "Google Drive campaign.pdf" });
  expect(card).toHaveClass("admin-sync-file-card--stopped");
  expect(card).not.toHaveClass("admin-sync-file-card--active");
  expect(card).toHaveTextContent("Stopped");
});

test("renders blank activity panel before sync begins", () => {
  render(<AdminSyncActivityPanel providers={providers} activityByProvider={{}} />);

  expect(screen.getByRole("region", { name: "Sync activity" })).toBeInTheDocument();
  expect(screen.queryByText("0 provider")).toBeNull();
  expect(screen.queryByText("No sync activity yet.")).toBeNull();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});
