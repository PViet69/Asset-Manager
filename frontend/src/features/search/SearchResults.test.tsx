import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SearchResults } from "./SearchResults";
import type { VectorSearchItem } from "../../types";
vi.mock("../../components/SearchResultThumbnail", () => ({
  SearchResultThumbnail: () => (
    <span aria-label="File thumbnail unavailable">File</span>
  ),
}));
afterEach(cleanup);
const item: VectorSearchItem = {
  point_id: "p",
  score: 0.872,
  filename:
    "very-long-filename-with-many-regional-campaign-details-and-quarterly-inventory.png",
  file_path: "/a",
  file_type: "image/png",
  content: "Campaign summary",
  source_url: "https://example.com/a",
};
test("long filename and source link remain accessible with score and snippet", () => {
  render(
    <SearchResults state={{ kind: "result", items: [item] }} items={[item]} />,
  );
  expect(
    screen.getByRole("link", { name: new RegExp(item.filename) }),
  ).toHaveAttribute("href", item.source_url);
  expect(screen.getByRole("link")).toHaveAttribute("title", item.filename);
  expect(screen.getByText("0.872")).toBeInTheDocument();
  expect(screen.getByText("Campaign summary")).toBeInTheDocument();
});
test("missing date provider and thumbnail renders truthful fallback", () => {
  render(
    <SearchResults
      state={{ kind: "result", items: [item] }}
      items={[{ ...item, modified_time: "invalid" }]}
    />,
  );
  expect(
    screen.getByLabelText("File thumbnail unavailable"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Invalid Date")).not.toBeInTheDocument();
  expect(screen.queryByRole("time")).not.toBeInTheDocument();
  expect(screen.queryByText("Dropbox")).not.toBeInTheDocument();
});
test("loading empty and error states are distinct", () => {
  const { rerender } = render(
    <SearchResults state={{ kind: "submitting" }} items={[]} />,
  );
  expect(screen.getByRole("progressbar", { name: "Searching assets" })).toBeInTheDocument();
  rerender(<SearchResults state={{ kind: "result", items: [] }} items={[]} />);
  expect(screen.getByText("No matching assets found")).toBeInTheDocument();
  rerender(
    <SearchResults
      state={{ kind: "error", message: "Search failed" }}
      items={[]}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Search failed");
});
