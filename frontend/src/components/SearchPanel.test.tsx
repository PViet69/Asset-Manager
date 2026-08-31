import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { searchVectors } from "../api/client";
import { SearchPanel } from "./SearchPanel";

vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  searchVectors: vi.fn(),
}));

vi.mock("./SearchResultThumbnail", () => ({
  SearchResultThumbnail: ({
    filename,
    thumbnailUrl,
  }: {
    filename: string;
    thumbnailUrl: string | null | undefined;
  }) =>
    thumbnailUrl ? (
      <img src="blob:thumbnail" alt={`Thumbnail for ${filename}`} />
    ) : (
      <span aria-label="File thumbnail unavailable">📄</span>
    ),
}));

const LONG_FILENAME =
  "quarterly-asset-inventory-and-regional-campaign-performance-report-2026-final-final-final.pdf";

const mockedSearchVectors = vi.mocked(searchVectors);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("keeps a long source filename accessible while showing its score", async () => {
  // Arrange
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [
      {
        point_id: "point-1",
        score: 0.872,
        filename: LONG_FILENAME,
        file_path: "/reports/quarterly.pdf",
        file_type: "application/pdf",
        content: "Quarterly campaign report",
        source_url: "https://example.com/reports/quarterly.pdf",
        thumbnail_url: "/v1/storage/dropbox/id:photo/thumbnail",
      },
      {
        point_id: "point-2",
        score: 0.701,
        filename: "campaign-summary.pdf",
        file_path: "/reports/summary.pdf",
        file_type: "application/pdf",
        content: "Campaign summary",
      },
    ],
  });
  render(<SearchPanel />);

  // Act
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "campaign report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  // Assert
  const filename = await screen.findByRole("link", { name: new RegExp(LONG_FILENAME) });
  expect(filename).toHaveAttribute("title", LONG_FILENAME);
  expect(filename).toHaveAttribute("href", "https://example.com/reports/quarterly.pdf");
  expect(filename.parentElement).toHaveClass("result-name");
  await waitFor(() => expect(screen.getByText("0.872")).toBeInTheDocument());
  expect(
    screen.getByRole("img", { name: `Thumbnail for ${LONG_FILENAME}` })
  ).toBeInTheDocument();
  expect(screen.getByLabelText("File thumbnail unavailable")).toBeInTheDocument();
  const resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList).toHaveClass("search-results--entering");
  expect(resultList.children[0]).toHaveStyle({ "--result-index": "0" });
  expect(resultList.children[1]).toHaveStyle({ "--result-index": "1" });
});

test("sends selected provider with search request", async () => {
  // Arrange
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  // Act
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "campaign report" },
  });
  fireEvent.change(screen.getByLabelText("Provider"), {
    target: { value: "google_drive" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  // Assert
  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "campaign report",
      10,
      "google_drive",
      "semantic"
    );
  });
});

test("hides Top K input and triggers real-time search on typing in filename mode", async () => {
  // Arrange
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  // Initially Top K is hidden inside settings popover
  expect(screen.queryByLabelText("Top K")).not.toBeInTheDocument();

  // Open Settings popover
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByLabelText("Top K")).toBeInTheDocument();

  // Close Settings popover
  fireEvent.click(screen.getByRole("button", { name: "Close settings" }));
  expect(screen.queryByLabelText("Top K")).not.toBeInTheDocument();

  // Switch to filename mode
  fireEvent.change(screen.getByLabelText("Search Mode"), {
    target: { value: "filename" },
  });

  // Act: type query
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "report.pdf" },
  });

  // Assert real-time debounced trigger
  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "report.pdf",
      100,
      undefined,
      "filename"
    );
  });
});
