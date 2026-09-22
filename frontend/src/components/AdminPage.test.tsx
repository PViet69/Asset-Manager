import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  deleteAdminQdrantPoint,
  discoverAdminTags,
  getAdminProviderItems,
  getAdminSession,
  getAdminSyncStatus,
  getAdminTags,
  loginAdmin,
  refreshAdminProvider,
  reindexAdminStorageFile,
  saveAdminTags,
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
  discoverAdminTags: vi.fn(),
  getAdminProviderItems: vi.fn(),
  getAdminSession: vi.fn(),
  getAdminSyncStatus: vi.fn(),
  getAdminTags: vi.fn().mockResolvedValue({ groups: [] }),
  loginAdmin: vi.fn(),
  refreshAdminProvider: vi.fn(),
  reindexAdminStorageFile: vi.fn(),
  saveAdminTags: vi.fn().mockResolvedValue({ groups: [] }),
  stopAdminSync: vi.fn(),
  streamAdminSync: vi.fn(),
}));

const mockedDeleteAdminQdrantPoint = vi.mocked(deleteAdminQdrantPoint);
const mockedDiscoverAdminTags = vi.mocked(discoverAdminTags);
const mockedGetAdminProviderItems = vi.mocked(getAdminProviderItems);
const mockedGetAdminSession = vi.mocked(getAdminSession);
const mockedGetAdminSyncStatus = vi.mocked(getAdminSyncStatus);
const mockedGetAdminTags = vi.mocked(getAdminTags);
const mockedLoginAdmin = vi.mocked(loginAdmin);
const mockedRefreshAdminProvider = vi.mocked(refreshAdminProvider);
const mockedReindexAdminStorageFile = vi.mocked(reindexAdminStorageFile);
const mockedSaveAdminTags = vi.mocked(saveAdminTags);
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
  mockedGetAdminTags.mockResolvedValue({ groups: [] });
  mockedSaveAdminTags.mockResolvedValue({ groups: [] });
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

test("scopes animated mesh styles to admin login background", () => {
  // Arrange
  const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  // Act
  const globalMeshSelector = "body::before";
  const loginMeshSelector = ".admin-login-background::before";

  // Assert
  expect(stylesheet).not.toContain(globalMeshSelector);
  expect(stylesheet).toContain(loginMeshSelector);
  expect(stylesheet).toContain(`${loginMeshSelector} {`);
  expect(stylesheet).toContain("animation: drift 22s ease-in-out infinite alternate;");
});

test("uses opaque surfaces instead of backdrop blur for dashboard cards", () => {
  // Arrange
  const stylesheet = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  // Act
  const cardsStart = stylesheet.indexOf("/* Glass Panels */");
  const cardsEnd = stylesheet.indexOf("/* 2-Card Metrics Grid */");
  const dashboardCardStyles = stylesheet.slice(cardsStart, cardsEnd);

  // Assert
  expect(dashboardCardStyles).not.toContain("backdrop-filter");
  expect(dashboardCardStyles).not.toContain("-webkit-backdrop-filter");
});

test("loads decorative interactive background outside sign-in controls", async () => {
  // Arrange
  mockSignedOut();

  // Act
  render(<AdminPage />);

  // Assert
  const background = await screen.findByTestId("admin-login-background");
  expect(background).toHaveAttribute("aria-hidden", "true");
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

test("renders skeleton cards across overview metrics, providers, and model health while dashboard is loading", async () => {
  let resolveStatus!: (value: Awaited<ReturnType<typeof getAdminSyncStatus>>) => void;
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockReturnValue(new Promise((resolve) => {
    resolveStatus = resolve;
  }));

  render(<AdminPage />);

  expect(await screen.findByRole("region", { name: "Key operational metrics" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("region", { name: "Storage providers" })).toHaveAttribute("aria-busy", "true");
  expect(screen.getByRole("region", { name: "Model health" })).toHaveAttribute("aria-busy", "true");

  resolveStatus(dashboard);
  expect(await screen.findByText("18 / 20")).toBeInTheDocument();
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

test("shows model unavailable dialog when provider sync is rejected", async () => {
  // Arrange
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedStreamAdminSync.mockRejectedValue(new ApiError(503, "Model not found"));
  render(<AdminPage />);

  // Act
  await user.click(await screen.findByRole("button", { name: "Sync Google Drive" }));

  // Assert
  expect(await screen.findByRole("alert")).toHaveTextContent("Service Unavailable");
  expect(screen.getByRole("alert")).toHaveTextContent("Model not found");
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

test("closes embedded items dialog with Escape", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedGetAdminProviderItems.mockResolvedValue({ provider: "google_drive", items: [] });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "View embedded items for Google Drive" }));

  expect(await screen.findByRole("dialog", { name: "Google Drive embedded items" })).toBeInTheDocument();

  await user.keyboard("{Escape}");

  expect(screen.queryByRole("dialog", { name: "Google Drive embedded items" })).not.toBeInTheDocument();
});

test("discovers tags into collapsed categories with a clearable selection", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedDiscoverAdminTags.mockResolvedValue({
    indexed_assets: 2,
    groups: [{ category: "Subjects", tags: ["subject:laptop"] }],
  });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));
  await user.click(screen.getByRole("button", { name: "Discover and index tags" }));

  expect(mockedDiscoverAdminTags).toHaveBeenCalledOnce();
  const subjects = await screen.findByRole("button", { name: "Subjects 0 selected" });
  expect(screen.queryByRole("button", { name: "laptop" })).not.toBeInTheDocument();

  await user.click(subjects);
  await user.click(screen.getByRole("button", { name: "laptop" }));
  expect(screen.getByText("1 tag selected")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Clear selection" }));
  expect(screen.getByText("No tags selected")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "laptop" }));
  await user.click(screen.getByRole("button", { name: "Save approved tags" }));

  await waitFor(() => expect(mockedSaveAdminTags).toHaveBeenCalledWith(
    ["subject:laptop"], ["subject:laptop"]
  ));
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

test("shows previously chosen tags on settings so admin can turn them off and save", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedGetAdminTags.mockResolvedValue({
    groups: [
      { category: "Formats", tags: ["format:png", "format:svg"] },
      { category: "Sources", tags: ["source:gdrive"] },
    ],
  });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));

  // Both categories are auto-expanded and chips are selected
  expect(await screen.findByText("3 tags selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Formats 2 selected" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Sources 1 selected" })).toBeInTheDocument();

  const pngChip = screen.getByRole("button", { name: "png" });
  const svgChip = screen.getByRole("button", { name: "svg" });
  const gdriveChip = screen.getByRole("button", { name: "gdrive" });

  expect(pngChip).toHaveAttribute("aria-pressed", "true");
  expect(svgChip).toHaveAttribute("aria-pressed", "true");
  expect(gdriveChip).toHaveAttribute("aria-pressed", "true");

  // Admin turns off "png"
  await user.click(pngChip);
  expect(pngChip).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByText("2 tags selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Formats 1 selected" })).toBeInTheDocument();

  // Admin saves updated tags
  await user.click(screen.getByRole("button", { name: "Save approved tags" }));

  await waitFor(() => {
    expect(mockedSaveAdminTags).toHaveBeenCalledWith(
      ["format:png", "format:svg", "source:gdrive"],
      ["format:svg", "source:gdrive"]
    );
  });
});

test("preserves previously approved tags when discovering new tags", async () => {
  const user = userEvent.setup();
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue(dashboard);
  mockedGetAdminTags.mockResolvedValue({
    groups: [{ category: "Formats", tags: ["format:png"] }],
  });
  mockedDiscoverAdminTags.mockResolvedValue({
    indexed_assets: 10,
    groups: [
      { category: "Formats", tags: ["format:png", "format:jpg"] },
      { category: "Subjects", tags: ["subject:car"] },
    ],
  });

  render(<AdminPage />);
  await user.click(await screen.findByRole("button", { name: "Settings" }));

  // Initial state shows saved tag
  expect(await screen.findByText("1 tag selected")).toBeInTheDocument();

  // Run discovery
  await user.click(screen.getByRole("button", { name: "Discover and index tags" }));

  expect(mockedDiscoverAdminTags).toHaveBeenCalledOnce();
  // Formats category has 1 selected (format:png preserved)
  expect(await screen.findByRole("button", { name: "Formats 1 selected" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Subjects 0 selected" })).toBeInTheDocument();

  // Formats was expanded because it has a selected tag
  const pngChip = screen.getByRole("button", { name: "png" });
  const jpgChip = screen.getByRole("button", { name: "jpg" });
  expect(pngChip).toHaveAttribute("aria-pressed", "true");
  expect(jpgChip).toHaveAttribute("aria-pressed", "false");
});
