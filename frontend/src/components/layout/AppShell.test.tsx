import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test } from "vitest";
import { AppShell } from "./AppShell";

afterEach(cleanup);

test("area navigation identifies the current page and preserves real destinations", () => {
  render(
    <AppShell activeArea="search">
      <main>Search workspace</main>
    </AppShell>,
  );
  const navigation = screen.getByRole("navigation", {
    name: "Main navigation",
  });
  expect(
    within(navigation).getByRole("link", { name: "Asset search" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    within(navigation).getByRole("link", { name: "Administration" }),
  ).toHaveAttribute("href", "/admin");
  expect(
    screen.queryByText("Your connected asset library"),
  ).not.toBeInTheDocument();
});

test("mobile navigation can be dismissed with Escape and restores trigger focus", async () => {
  render(
    <AppShell activeArea="admin">
      <main>Admin workspace</main>
    </AppShell>,
  );
  const trigger = screen.getByRole("button", { name: "Open navigation" });
  await userEvent.click(trigger);
  expect(
    screen.getByRole("dialog", { name: "Navigation" }),
  ).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});
