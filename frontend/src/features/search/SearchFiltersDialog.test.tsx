import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { SearchFiltersDialog } from "./SearchFiltersDialog";
import type { SearchFilters } from "./search.types";
afterEach(cleanup);
function setup(initial: SearchFilters = { provider: "", tags: [] }) {
  const onApply = vi.fn();
  function Wrapper() {
    const [value, setValue] = useState(initial);
    return (
      <SearchFiltersDialog
        value={value}
        providers={[{ id: "dropbox", displayName: "Dropbox" }]}
        groups={[{ category: "Subject", tags: ["subject:laptop"] }]}
        onApply={(v) => {
          setValue(v);
          onApply(v);
        }}
      />
    );
  }
  render(<Wrapper />);
  return { user: userEvent.setup(), onApply };
}
test.each(["Cancel", "Escape"])(
  "%s discards draft provider and tags",
  async (action) => {
    const { user, onApply } = setup();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("button", { name: /Provider/ }));
    await user.click(screen.getByRole("option", { name: "Dropbox" }));
    await user.click(screen.getByRole("checkbox", { name: "laptop" }));
    if (action === "Cancel")
      await user.click(screen.getByRole("button", { name: "Cancel" }));
    else await user.keyboard("{Escape}");
    expect(onApply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Filters" }));
    expect(screen.getByRole("checkbox", { name: "laptop" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: /Provider/ })).toHaveTextContent(
      "All providers",
    );
  },
);
test("Apply commits both exactly once and reopening initializes from applied filters", async () => {
  const { user, onApply } = setup();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  await user.click(screen.getByRole("button", { name: /Provider/ }));
  await user.click(screen.getByRole("option", { name: "Dropbox" }));
  await user.click(screen.getByRole("checkbox", { name: "laptop" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onApply).toHaveBeenCalledWith({
    provider: "dropbox",
    tags: ["subject:laptop"],
  });
  await user.click(screen.getByRole("button", { name: "Filters (2)" }));
  expect(screen.getByRole("checkbox", { name: "laptop" })).toBeChecked();
});
test("clear filters uses empty provider and tags", async () => {
  const { user, onApply } = setup({
    provider: "dropbox",
    tags: ["subject:laptop"],
  });
  await user.click(screen.getByRole("button", { name: "Filters (2)" }));
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  await user.click(screen.getByRole("button", { name: "Apply" }));
  expect(onApply).toHaveBeenCalledWith({ provider: "", tags: [] });
});
test("Escape closes provider select before filter dialog", async () => {
  const { user } = setup();
  await user.click(screen.getByRole("button", { name: "Filters" }));
  const provider = screen.getByRole("button", { name: /Provider/ });
  await user.click(provider);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Filters" })).toBeInTheDocument();
  await waitFor(() => expect(provider).toHaveFocus());
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus(),
  );
});
