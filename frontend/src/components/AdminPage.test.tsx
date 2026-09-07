import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  deleteAdminQdrantPoint,
  getAdminProviderItems,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
  refreshAdminProvider,
  reindexAdminStorageFile,
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
  deleteAdminQdrantPoint: vi.fn(),
  getAdminProviderItems: vi.fn(),
  getAdminSession: vi.fn(),
  getAdminSyncStatus: vi.fn(),
  loginAdmin: vi.fn(),
  refreshAdminProvider: vi.fn(),
  reindexAdminStorageFile: vi.fn(),
  stopAdminSync: vi.fn(),
  streamAdminSync: vi.fn(),
}));

const mockedDeleteAdminQdrantPoint = vi.mocked(deleteAdminQdrantPoint);
const mockedGetAdminProviderItems = vi.mocked(getAdminProviderItems);
const mockedGetAdminSession = vi.mocked(getAdminSession);
const mockedGetAdminSyncStatus = vi.mocked(getAdminSyncStatus);
const mockedLoginAdmin = vi.mocked(loginAdmin);
const mockedRefreshAdminProvider = vi.mocked(refreshAdminProvider);
const mockedReindexAdminStorageFile = vi.mocked(reindexAdminStorageFile);
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

test("shows concise admin sign-in", () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  expect(screen.getByRole("heading", { name: "Admin sign in" })).toBeInTheDocument();
  expect(document.title).toBe("Admin Dashboard");
});

test("does not show protected workspace text on sign-in", () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  expect(screen.queryByText("Protected workspace")).not.toBeInTheDocument();
});

test("uses admin workspace styling for sign-in", () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  expect(screen.getByRole("main")).toHaveClass("admin-shell", "admin-login-shell");
});

test("includes a decorative interactive background outside sign-in controls", () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  expect(document.querySelector(".admin-login-background")).toHaveAttribute("aria-hidden", "true");
  expect(document.querySelector(".admin-login-background canvas")).toBeInTheDocument();
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
    "The login information you entered is incorrect."
  );
});

test("clears invalid login error when typing", async () => {
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

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The login information you entered is incorrect."
  );

  await user.type(screen.getByLabelText("Password"), "1");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("shows rate limit error on 429", async () => {
  // Arrange
  const user = userEvent.setup();
  mockSignedOut();
  mockedLoginAdmin.mockRejectedValue(
    new ApiError(429, "Login rate limit exceeded")
  );
  render(<AdminPage />);

  // Act
  await user.type(await screen.findByLabelText("Username"), "admin");
  await user.type(screen.getByLabelText("Password"), "any-password");
  await user.click(screen.getByRole("button", { name: "Sign in" }));

  // Assert
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Too many login attempts. Please wait 5 seconds and try again."
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

  expect(await screen.findByText("18 / 20")).toBeInTheDocument();
  expect(screen.getByText("2 / 3")).toBeInTheDocument();
  expect(screen.getByText("nomic-embed-text")).toBeInTheDocument();
});

test("embeds indexing progress in each provider card instead of a separate analytics panel", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);

  const googleDriveProgress = await screen.findByRole("region", { name: "Google Drive vector indexing progress" });
  const dropboxProgress = screen.getByRole("region", { name: "Dropbox vector indexing progress" });

  expect(googleDriveProgress).toHaveTextContent("18 / 20");
  expect(googleDriveProgress).toHaveTextContent("90%");
  expect(dropboxProgress).toHaveTextContent("2 / 3");
  expect(dropboxProgress).toHaveTextContent("67%");
  expect(screen.queryByText("Storage Vector Indexing Progress")).not.toBeInTheDocument();
});

test("shows a compact sign-out action for an authenticated administrator", async () => {
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
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

test("does not show provider search filters in the admin dashboard", async () => {
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);
  await screen.findByRole("region", { name: "Storage providers" });

  expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
});



test("loads and displays embedded provider items and allows deleting an item", async () => {
  const user = userEvent.setup();
  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedGetAdminProviderItems.mockResolvedValue({
    provider: "dropbox",
    items: [
      { point_id: "p1", filename: "dropbox-file-1.pdf", file_type: "application/pdf" },
      { point_id: "p2", filename: "dropbox-file-2.png", file_type: "image/png" },
    ],
  });
  mockedDeleteAdminQdrantPoint.mockResolvedValue({ point_id: "p1", deleted: 1 });

  render(<AdminPage />);

  const viewBtn = await screen.findByRole("button", { name: "View embedded items for Dropbox" });
  await user.click(viewBtn);

  expect(mockedGetAdminProviderItems).toHaveBeenCalledWith("dropbox");

  expect(await screen.findByText("dropbox-file-1.pdf")).toBeInTheDocument();
  expect(screen.getByText("dropbox-file-2.png")).toBeInTheDocument();

  const deleteBtn = screen.getByRole("button", { name: "Delete dropbox-file-1.pdf" });
  await user.click(deleteBtn);

  expect(confirmSpy).toHaveBeenCalledWith('Delete embedded Qdrant item "dropbox-file-1.pdf"?');
  expect(mockedDeleteAdminQdrantPoint).toHaveBeenCalledWith("p1");
  expect(await screen.findByText('Deleted embedded item "dropbox-file-1.pdf".')).toBeInTheDocument();
  expect(screen.queryByText("dropbox-file-1.pdf")).not.toBeInTheDocument();
});

test("opens mobile navigation from compact topbar", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);
  await screen.findByRole("region", { name: "Storage providers" });

  expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Open navigation" }));

  const drawer = screen.getByRole("dialog", { name: "Admin navigation" });
  expect(within(drawer).getByRole("button", { name: "Overview" })).toBeInTheDocument();
  expect(within(drawer).getByRole("button", { name: "Providers" })).toBeInTheDocument();
  expect(within(drawer).getByRole("button", { name: "Models" })).toBeInTheDocument();
  expect(within(drawer).getByRole("button", { name: "Activity" })).toBeInTheDocument();
  expect(within(drawer).getByRole("button", { name: "Settings" })).toBeInTheDocument();

  await user.click(within(drawer).getByRole("button", { name: "Close navigation" }));
  expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();
});

test("does not show navigation controls on login page", async () => {
  mockSignedOut();

  render(<AdminPage />);
  await screen.findByLabelText("Username");

  expect(screen.queryByRole("button", { name: "Open navigation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();
});

test("renders real assets detected chart with provider breakdown and filters", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);

  render(<AdminPage />);
  await screen.findByRole("region", { name: "Storage providers" });

  const chartViewport = screen.getByLabelText("Assets breakdown chart");
  expect(chartViewport).toBeInTheDocument();

  // "All (23)" filter chip is active by default
  const allChip = screen.getByRole("tab", { name: "All (23)" });
  expect(allChip).toBeInTheDocument();
  expect(allChip).toHaveAttribute("aria-selected", "true");

  // Multi-provider columns exist in the chart
  expect(within(chartViewport).getByText("Google Drive")).toBeInTheDocument();
  expect(within(chartViewport).getByText("Dropbox")).toBeInTheDocument();

  // Click Dropbox provider filter tab to drill down into its breakdown
  const dropboxChip = screen.getByRole("tab", { name: "Dropbox (3)" });
  await user.click(dropboxChip);

  expect(dropboxChip).toHaveAttribute("aria-selected", "true");
  expect(allChip).toHaveAttribute("aria-selected", "false");
  expect(within(chartViewport).getByText("Detected")).toBeInTheDocument();
  expect(within(chartViewport).getByText("Indexed")).toBeInTheDocument();
  expect(within(chartViewport).getByText("Pending")).toBeInTheDocument();
});
