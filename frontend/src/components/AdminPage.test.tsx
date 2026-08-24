import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { getAdminSyncStatus } from "../api/client";
import { AdminPage } from "./AdminPage";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  getAdminSyncStatus: vi.fn(),
  triggerAdminSync: vi.fn(),
}));

const mockedGetAdminSyncStatus = vi.mocked(getAdminSyncStatus);

test("renders compact sync summary and keeps raw activity collapsed", async () => {
  // Arrange
  mockedGetAdminSyncStatus.mockResolvedValue({
    providers: [
      {
        provider: "dropbox",
        display_name: "Dropbox",
        enabled: true,
        health: "ok",
        last_upserted: 4,
        last_deleted: 0,
        last_unchanged: 2,
        last_failed: 0,
        last_traces: [
          {
            timestamp: "2026-08-24T10:00:00Z",
            provider: "dropbox",
            step: "download",
            status: "ok",
            detail: "Downloaded file",
            filename: "brief.pdf",
            storage_file_id: "file-1",
          },
          {
            timestamp: "2026-08-24T10:00:01Z",
            provider: "dropbox",
            step: "index",
            status: "ok",
            detail: "Indexed file",
            filename: "brief.pdf",
            storage_file_id: "file-1",
          },
        ],
      },
    ],
  });
  render(<AdminPage />);

  // Act
  fireEvent.change(screen.getByLabelText("Admin API key"), {
    target: { value: "admin-key" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Load providers" }));

  // Assert
  expect(await screen.findByText("Connected")).toBeInTheDocument();
  expect(screen.getByText("Last sync result")).toBeInTheDocument();
  expect(screen.getByText("Indexed")).toBeInTheDocument();
  expect(screen.getByText("Deleted")).toBeInTheDocument();
  expect(screen.getByText("Failed")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
  expect(screen.getByText("2 activity events")).toBeInTheDocument();
  const activity = screen.getByText("View activity").closest("details");
  expect(activity).not.toHaveAttribute("open");

  fireEvent.click(screen.getByText("View activity"));
  expect(activity).toHaveAttribute("open");
  expect(screen.getByText("Downloaded file")).toBeInTheDocument();
  expect(screen.getByText("Indexed file")).toBeInTheDocument();
});
