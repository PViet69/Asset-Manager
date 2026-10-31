import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { ApprovedTagsPanel } from "./ApprovedTagsPanel";

afterEach(cleanup);

test("finding a tag shows its category without dropping hidden approved tags on save", async () => {
  const user = userEvent.setup();
  const save = vi.fn();
  const toggle = vi.fn();
  const model = {
    groups: [{category:"Subjects", tags:["subject:cat", "subject:dog"]}, {category:"Colors", tags:["color:blue"]}],
    selected: ["subject:dog", "color:blue"],
    expandedCategories: new Set<string>(),
    isLoading:false, isSaving:false, isDiscovering:false,
    discover:vi.fn(), save, toggle, toggleCategory:vi.fn(), clear:vi.fn(),
  };
  render(<ApprovedTagsPanel model={model} />);
  await user.type(screen.getByRole("searchbox", {name:"Find approved tags"}), "cat");
  expect(screen.getByRole("checkbox", {name:"cat"})).toBeInTheDocument();
  expect(screen.queryByRole("checkbox", {name:"blue"})).not.toBeInTheDocument();
  expect(screen.getByText("2 tags selected")).toBeInTheDocument();
  await user.click(screen.getByRole("checkbox", {name:"cat"}));
  expect(toggle).toHaveBeenCalledWith("subject:cat");
  await user.click(screen.getByRole("button", {name:"Save approved tags"}));
  expect(save).toHaveBeenCalledOnce();
  expect(model.selected).toEqual(["subject:dog", "color:blue"]);
});
