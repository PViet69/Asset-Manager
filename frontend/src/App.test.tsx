import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { App } from "./App";

vi.mock("./components/SearchPanel", () => ({
  SearchPanel: () => <div>Search panel</div>,
}));

vi.mock("./components/AdminPage", () => ({
  AdminPage: () => <div>Admin page</div>,
}));

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

test("shows Asset Manager title on public search route", () => {
  // Arrange
  window.history.replaceState({}, "", "/");

  // Act
  render(<App />);

  // Assert
  expect(screen.getByRole("heading", { name: "Asset Manager" })).toBeInTheDocument();
  expect(document.title).toBe("Asset Manager");
});

test("lazy-loads AdminPage for admin routes", async () => {
  for (const path of ["/admin", "/admin/login", "/admin/dashboard"]) {
    window.history.replaceState({}, "", path);
    const { unmount } = render(<App />);
    expect(await screen.findByText("Admin page")).toBeInTheDocument();
    unmount();
  }
});
