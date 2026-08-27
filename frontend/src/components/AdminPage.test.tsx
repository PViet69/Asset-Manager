import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
  refreshAdminProvider,
  stopAdminSync,
  streamAdminSync,
} from "../api/client";
import { AdminPage } from "./AdminPage";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message);
    }
  },
  getAdminSession: vi.fn(),
  getAdminSyncStatus: vi.fn(),
  loginAdmin: vi.fn(),
  refreshAdminProvider: vi.fn(),
  stopAdminSync: vi.fn(),
  streamAdminSync: vi.fn(),
}));

const mockedGetAdminSession = vi.mocked(getAdminSession);
const mockedGetAdminSyncStatus = vi.mocked(getAdminSyncStatus);
const mockedLoginAdmin = vi.mocked(loginAdmin);
const mockedRefreshAdminProvider = vi.mocked(refreshAdminProvider);
const mockedStreamAdminSync = vi.mocked(streamAdminSync);

const dashboard = {
  providers: [
    { provider: "google_drive", display_name: "Google Drive", enabled: true, health: "ok", detected_count: 20, embedded_count: 18 },
    { provider: "dropbox", display_name: "Dropbox", enabled: true, health: "ok", detected_count: 3, embedded_count: 2 },
  ],
  embedding_model: { name: "nomic-embed-text", health: "ok" },
  description_model: { name: "llava:latest", health: "ok" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockSignedOut(): void {
  mockedGetAdminSession.mockRejectedValue(
    new ApiError(401, "Authentication required")
  );
}

test("shows Asset Tracker admin branding", () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  expect(screen.getByText("Asset Tracker")).toBeInTheDocument();
  expect(document.title).toBe("Admin Dashboard");
});

test("logs in then loads provider status", async () => {
  // Arrange
  const user = userEvent.setup();
  mockSignedOut();
  mockedLoginAdmin.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({
    providers: [],
    embedding_model: { name: "embed-v1", health: "ok" },
    description_model: { name: "describe-v1", health: "ok" },
  });
  render(<AdminPage />);

  // Act
  await user.type(await screen.findByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), "correct-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  // Assert
  expect(mockedLoginAdmin).toHaveBeenCalledWith("admin", "correct-password");
  expect(mockedGetAdminSyncStatus).toHaveBeenCalledOnce();
  expect(screen.getByRole("region", { name: "Storage providers" })).toBeInTheDocument();
});

test("shows invalid login error", async () => {
  // Arrange
  const user = userEvent.setup();
  mockSignedOut();
  mockedLoginAdmin.mockRejectedValue(
    new ApiError(401, "Invalid username or password")
  );
  render(<AdminPage />);

  // Act
  await user.type(await screen.findByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), "wrong-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  // Assert
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Invalid username or password"
  );
});

test("restores session on page load", async () => {
  // Arrange
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({
    providers: [],
    embedding_model: { name: "embed-v1", health: "ok" },
    description_model: { name: "describe-v1", health: "ok" },
  });

  // Act
  render(<AdminPage />);

  // Assert
  expect(await screen.findByRole("region", { name: "Storage providers" })).toBeInTheDocument();
});

test("returns to login when provider status returns 401", async () => {
  // Arrange
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockRejectedValue(
    new ApiError(401, "Authentication required")
  );

  // Act
  render(<AdminPage />);

  // Assert
  await screen.findByLabelText("Username");
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

test("renders detected and embedded counts plus model health", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);

  expect(await screen.findByText("20")).toBeInTheDocument();
  expect(screen.getByText("18")).toBeInTheDocument();
  expect(screen.getByText("nomic-embed-text")).toBeInTheDocument();
});

test("refresh disables only selected provider action", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedRefreshAdminProvider.mockReturnValue(new Promise(() => undefined));

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Refresh Google Drive" }));

  expect(screen.getByRole("button", { name: "Refreshing Google Drive" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh Dropbox" })).toBeEnabled();
});

test("renders independent panels for concurrent provider streams", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedStreamAdminSync.mockImplementation((provider, onEvent) => {
    onEvent({ sequence: 1, provider, filename: "asset.png", status: "loading", detail: "Loading file", terminal: false });
    return new Promise(() => undefined);
  });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Sync Google Drive" }));
  await user.click(screen.getByRole("button", { name: "Sync Dropbox" }));

  expect(screen.getByLabelText("Google Drive sync activity")).toBeInTheDocument();
  expect(screen.getByLabelText("Dropbox sync activity")).toBeInTheDocument();
});

test("does not show a sign-out button for an authenticated administrator", async () => {
  // Arrange
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({
    providers: [],
    embedding_model: { name: "embed-v1", health: "ok" },
    description_model: { name: "describe-v1", health: "ok" },
  });

  // Act
  render(<AdminPage />);

  // Assert
  await screen.findByRole("region", { name: "Storage providers" });
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});

test("changes sync button to stop syncing while syncing and stops on click", async () => {
  const user = userEvent.setup();
  const mockedStopAdminSync = vi.mocked(stopAdminSync);
  mockedStopAdminSync.mockResolvedValue({ status: "stopping", provider: "google_drive" });
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedStreamAdminSync.mockImplementation(() => new Promise(() => undefined));

  render(<AdminPage />);
  const syncBtn = await screen.findByRole("button", { name: "Sync Google Drive" });
  await user.click(syncBtn);

  const stopBtn = screen.getByRole("button", { name: "Stop syncing Google Drive" });
  expect(stopBtn).toBeEnabled();

  await user.click(stopBtn);
  expect(mockedStopAdminSync).toHaveBeenCalledWith("google_drive");
});

test("updates sync activity in place for the same asset instead of rendering 2 cards", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedStreamAdminSync.mockImplementation((provider, onEvent) => {
    onEvent({ sequence: 1, provider, filename: "photo.jpg", status: "loading", detail: "Loading file", terminal: false });
    onEvent({ sequence: 2, provider, filename: "photo.jpg", status: "done", detail: "Indexed file", terminal: false });
    return new Promise(() => undefined);
  });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Sync Google Drive" }));

  const activitySection = screen.getByRole("region", { name: "Google Drive sync activity" });
  const items = activitySection.querySelectorAll("li");
  expect(items).toHaveLength(1);
  expect(items[0]).toHaveTextContent("photo.jpg");
  expect(items[0]).toHaveTextContent("done");
});

test("does not show provider search filters in the admin dashboard", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);
  await screen.findByRole("region", { name: "Storage providers" });

  expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
});
