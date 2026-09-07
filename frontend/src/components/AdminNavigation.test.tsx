import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { AdminNavigation } from "./AdminNavigation";

test("selects requested admin section from desktop navigation", async () => {
  const user = userEvent.setup();
  const onSelectTab = vi.fn();
  render(
    <AdminNavigation
      activeTab="dashboards"
      isMobileOpen={false}
      onSelectTab={onSelectTab}
      onCloseMobile={vi.fn()}
    />
  );

  await user.click(screen.getByRole("button", { name: "Models" }));

  expect(onSelectTab).toHaveBeenCalledWith("models");
});

test("renders mobile dialog only when navigation is open", () => {
  const { rerender } = render(
    <AdminNavigation
      activeTab="dashboards"
      isMobileOpen={false}
      onSelectTab={vi.fn()}
      onCloseMobile={vi.fn()}
    />
  );

  expect(screen.queryByRole("dialog", { name: "Admin navigation" })).not.toBeInTheDocument();

  rerender(
    <AdminNavigation
      activeTab="dashboards"
      isMobileOpen
      onSelectTab={vi.fn()}
      onCloseMobile={vi.fn()}
    />
  );

  expect(screen.getByRole("dialog", { name: "Admin navigation" })).toBeInTheDocument();
});
