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

test("renders safe ingestion activity grouped by provider and newest first", () => {
  render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        google_drive: [
          { sequence: 1, storage_file_id: "drive-1", filename: "first.pdf", status: "preparing" },
          { sequence: 2, storage_file_id: "drive-2", filename: "second.pdf", status: "indexed" },
        ],
        dropbox: [{ sequence: 1, storage_file_id: "dropbox-1", filename: "retry.pdf", status: "indexing" }],
      }}
    />
  );

  const panel = screen.getByRole("region", { name: "Sync activity" });
  expect(panel).toHaveAttribute("aria-live", "polite");
  expect(screen.getAllByRole("article").map((card) => card.getAttribute("aria-label"))).toEqual([
    "second.pdf: Indexed",
    "first.pdf: Preparing",
    "retry.pdf: Indexing",
  ]);
  expect(panel).toHaveTextContent("Google Drive");
  expect(panel).toHaveTextContent("Dropbox");
  expect(panel).not.toHaveTextContent("internal detail");

  const indexingCard = screen.getByRole("article", { name: "retry.pdf: Indexing" });
  expect(indexingCard).toHaveClass("admin-sync-file-card--entering");
  expect(indexingCard).toHaveClass("admin-sync-file-card--active");
  expect(indexingCard).toHaveClass("admin-sync-file-card--dropbox");

  const indexedCard = screen.getByRole("article", { name: "second.pdf: Indexed" });
  expect(indexedCard).toHaveClass("admin-sync-file-card--entering");
  expect(indexedCard).not.toHaveClass("admin-sync-file-card--active");
  expect(indexedCard).toHaveClass("admin-sync-file-card--google-drive");
});

test("renders duplicate filenames as distinct file cards", () => {
  render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        google_drive: [
          { sequence: 1, storage_file_id: "folder-a/report", filename: "report.pdf", status: "indexed" },
          { sequence: 2, storage_file_id: "folder-b/report", filename: "report.pdf", status: "failed" },
        ],
      }}
    />
  );

  expect(screen.getAllByRole("article", { name: /report\.pdf/ })).toHaveLength(2);
  expect(screen.getByRole("article", { name: "report.pdf: Failed" })).toBeInTheDocument();
  expect(screen.getByRole("article", { name: "report.pdf: Indexed" })).toBeInTheDocument();
});

test("renders stopped ingestion activity", () => {
  render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{ google_drive: [{ sequence: 4, storage_file_id: "drive-4", filename: "stopped.pdf", status: "stopped" }] }}
    />
  );

  expect(screen.getByRole("article", { name: "stopped.pdf: Stopped" })).toBeInTheDocument();
});

test("renders blank activity panel before sync begins", () => {
  render(<AdminSyncActivityPanel providers={providers} activityByProvider={{}} />);

  expect(screen.getByRole("region", { name: "Sync activity" })).toBeInTheDocument();
  expect(screen.getByText("No ingestion activity yet.")).toBeInTheDocument();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
});

test("triggers circle wave animation when file transitions to indexed", () => {
  const { rerender } = render(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        google_drive: [
          { sequence: 1, storage_file_id: "drive-1", filename: "sample.pdf", status: "indexing" },
        ],
      }}
    />
  );

  const card = screen.getByRole("article", { name: "sample.pdf: Indexing" });
  expect(card).not.toHaveClass("admin-sync-file-card--wave-circle");

  rerender(
    <AdminSyncActivityPanel
      providers={providers}
      activityByProvider={{
        google_drive: [
          { sequence: 1, storage_file_id: "drive-1", filename: "sample.pdf", status: "indexed" },
        ],
      }}
    />
  );

  const updatedCard = screen.getByRole("article", { name: "sample.pdf: Indexed" });
  expect(updatedCard).toHaveClass("admin-sync-file-card--wave-circle");
});

