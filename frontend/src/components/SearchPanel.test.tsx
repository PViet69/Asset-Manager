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
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
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

test("hides Search Results input and triggers real-time search on typing in filename mode", async () => {
  // Arrange
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  // Open Settings popover
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  expect(screen.getByLabelText("Search Results")).toBeInTheDocument();

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

test("sorts search results by date in filename search mode (newest and oldest first)", async () => {
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [
      {
        point_id: "point-1",
        score: 0.9,
        filename: "old-doc.pdf",
        file_path: "/old-doc.pdf",
        file_type: "application/pdf",
        content: "Old document",
        modified_time: "2025-01-15T10:00:00Z",
      },
      {
        point_id: "point-2",
        score: 0.8,
        filename: "new-doc.pdf",
        file_path: "/new-doc.pdf",
        file_type: "application/pdf",
        content: "New document",
        modified_time: "2026-08-20T10:00:00Z",
      },
    ],
  });
  render(<SearchPanel />);

  // Open Settings popover and switch to filename mode
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.change(screen.getByLabelText("Search Mode"), {
    target: { value: "filename" },
  });

  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "doc.pdf" },
  });

  await screen.findByText("old-doc.pdf");

  // Score is omitted in filename search mode
  expect(screen.queryByText("0.900")).not.toBeInTheDocument();
  expect(screen.queryByText("0.800")).not.toBeInTheDocument();

  // Default order
  let resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("old-doc.pdf");
  expect(resultList.children[1]).toHaveTextContent("new-doc.pdf");

  // Sort by date (Newest first)
  const sortSelect = screen.getByLabelText("Sort by date");
  fireEvent.change(sortSelect, { target: { value: "date_desc" } });

  resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("new-doc.pdf");
  expect(resultList.children[1]).toHaveTextContent("old-doc.pdf");

  // Sort by date (Oldest first)
  fireEvent.change(sortSelect, { target: { value: "date_asc" } });

  resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("old-doc.pdf");
  expect(resultList.children[1]).toHaveTextContent("new-doc.pdf");
});

test("closes search options popover when clicking outside but keeps open when clicking inside", () => {
  render(<SearchPanel />);

  const settingsButton = screen.getByRole("button", { name: "Settings" });
  fireEvent.click(settingsButton);

  const popover = screen.getByRole("dialog", { name: "Settings popover" });
  expect(popover).toBeInTheDocument();

  // Click inside popover (e.g. on Search Mode dropdown)
  const searchModeSelect = screen.getByLabelText("Search Mode");
  fireEvent.mouseDown(searchModeSelect);
  expect(screen.getByRole("dialog", { name: "Settings popover" })).toBeInTheDocument();

  // Click outside (e.g. on document body)
  fireEvent.mouseDown(document.body);
  expect(screen.queryByRole("dialog", { name: "Settings popover" })).not.toBeInTheDocument();
});


