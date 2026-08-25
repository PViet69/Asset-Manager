import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  getAdminSession,
  getAdminSyncStatus,
  loginAdmin,
  logoutAdmin,
  triggerAdminSync,
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
  logoutAdmin: vi.fn(),
  triggerAdminSync: vi.fn(),
}));

const mockedGetAdminSession = vi.mocked(getAdminSession);
const mockedGetAdminSyncStatus = vi.mocked(getAdminSyncStatus);
const mockedLoginAdmin = vi.mocked(loginAdmin);
const mockedLogoutAdmin = vi.mocked(logoutAdmin);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function mockSignedOut(): void {
  mockedGetAdminSession.mockRejectedValue(
    new ApiError(401, "Authentication required")
  );
}

test("logs in then loads provider status", async () => {
  // Arrange
  const user = userEvent.setup();
  mockSignedOut();
  mockedLoginAdmin.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({ providers: [] });
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
  mockedGetAdminSyncStatus.mockResolvedValue({ providers: [] });

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

test("does not show a sign-out button for an authenticated administrator", async () => {
  // Arrange
  mockedGetAdminSession.mockResolvedValue({ username: "admin" });
  mockedGetAdminSyncStatus.mockResolvedValue({ providers: [] });

  // Act
  render(<AdminPage />);

  // Assert
  await screen.findByRole("region", { name: "Storage providers" });
  expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
});
