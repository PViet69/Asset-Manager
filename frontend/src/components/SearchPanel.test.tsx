import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { searchVectors } from "../api/client";
import { SearchPanel } from "./SearchPanel";



vi.mock("../api/client", () => ({
  ApiError: class ApiError extends Error {},
  searchVectors: vi.fn(),
  getApprovedTags: vi.fn().mockResolvedValue({
    groups: [{ category: "Subjects", tags: ["subject:laptop"] }],
  }),
  getProviders: vi.fn().mockResolvedValue([
    { id: "google_drive", displayName: "Google Drive" },
    { id: "dropbox", displayName: "Dropbox" },
  ]),
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
  "quarterly-asset-inventory-and-regional-campaign-performance-report-2026-final-final-final.png";

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
        file_path: "/assets/quarterly.png",
        file_type: "image/png",
        content: "Quarterly campaign asset",
        source_url: "https://example.com/assets/quarterly.png",
        thumbnail_url: "/v1/storage/dropbox/id:photo/thumbnail",
      },
      {
        point_id: "point-2",
        score: 0.701,
        filename: "campaign-summary.png",
        file_path: "/assets/summary.png",
        file_type: "image/png",
        content: "Campaign summary asset",
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
  expect(filename).toHaveAttribute("href", "https://example.com/assets/quarterly.png");
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
  const providerBtn = await screen.findByRole("button", { name: /Google Drive/i });
  fireEvent.click(providerBtn);
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

test("triggers real-time search on typing in filename mode", async () => {
  // Arrange
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  // Switch to filename mode
  fireEvent.click(screen.getByRole("tab", { name: "Filename Search" }));

  // Act: type query
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "report.png" },
  });

  // Assert real-time debounced trigger
  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "report.png",
      100,
      undefined,
      "filename"
    );
  });
});

test("searches selected approved tags newest first", async () => {
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [
      {
        point_id: "old", score: 1, filename: "old.png", file_path: "/old.png",
        file_type: "image/png", content: "old", modified_time: "2025-01-15T10:00:00Z",
      },
      {
        point_id: "new", score: 1, filename: "new.png", file_path: "/new.png",
        file_type: "image/png", content: "new", modified_time: "2026-08-20T10:00:00Z",
      },
    ],
  });
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("tab", { name: "Tag Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "laptop" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "", 100, undefined, "tag", ["subject:laptop"]
    );
  });
  const resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("new.png");
  expect(resultList.children[1]).toHaveTextContent("old.png");
});

test("sorts search results by date in filename search mode (newest and oldest first)", async () => {
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [
      {
        point_id: "point-1",
        score: 0.9,
        filename: "old-asset.png",
        file_path: "/old-asset.png",
        file_type: "image/png",
        content: "Old asset",
        modified_time: "2025-01-15T10:00:00Z",
      },
      {
        point_id: "point-2",
        score: 0.8,
        filename: "new-asset.png",
        file_path: "/new-asset.png",
        file_type: "image/png",
        content: "New asset",
        modified_time: "2026-08-20T10:00:00Z",
      },
    ],
  });
  render(<SearchPanel />);

  // Switch to filename mode
  fireEvent.click(screen.getByRole("tab", { name: "Filename Search" }));

  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "asset.png" },
  });

  await screen.findByText("old-asset.png");

  // Score is omitted in filename search mode
  expect(screen.queryByText("0.900")).not.toBeInTheDocument();
  expect(screen.queryByText("0.800")).not.toBeInTheDocument();

  // Default order
  let resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("old-asset.png");
  expect(resultList.children[1]).toHaveTextContent("new-asset.png");

  // Sort by date (Newest first)
  const sortSelect = screen.getByLabelText("Sort by date");
  fireEvent.change(sortSelect, { target: { value: "date_desc" } });

  resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("new-asset.png");
  expect(resultList.children[1]).toHaveTextContent("old-asset.png");

  // Sort by date (Oldest first)
  fireEvent.change(sortSelect, { target: { value: "date_asc" } });

  resultList = screen.getByRole("list", { name: "Search results" });
  expect(resultList.children[0]).toHaveTextContent("old-asset.png");
  expect(resultList.children[1]).toHaveTextContent("new-asset.png");
});

test("does not render the settings button", () => {
  render(<SearchPanel />);
  expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
});

test("re-triggers search when changing provider during search", async () => {
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [
      {
        point_id: "p-1",
        score: 0.95,
        filename: "asset-dropbox.png",
        file_path: "/asset-dropbox.png",
        file_type: "image/png",
        content: "Dropbox content",
        provider: "dropbox",
      },
    ],
  });
  render(<SearchPanel />);

  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "quarterly report" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "quarterly report",
      10,
      undefined,
      "semantic"
    );
  });
  expect(await screen.findByText("asset-dropbox.png")).toBeInTheDocument();

  // Now change provider during search to Google Drive
  const gdriveBtn = await screen.findByRole("button", { name: /Google Drive/i });
  fireEvent.click(gdriveBtn);

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "quarterly report",
      10,
      "google_drive",
      "semantic"
    );
  });

  // Clicking provider pill on a search result item also changes provider filter
  const providerPill = screen.getByTitle("Filter by dropbox");
  fireEvent.click(providerPill);

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "quarterly report",
      10,
      "dropbox",
      "semantic"
    );
  });
});

test("re-triggers search when changing provider during tag search", async () => {
  mockedSearchVectors.mockResolvedValue({
    object: "list",
    data: [],
  });
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("tab", { name: "Tag Search" }));
  fireEvent.click(await screen.findByRole("button", { name: "laptop" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "",
      100,
      undefined,
      "tag",
      ["subject:laptop"]
    );
  });

  const dropboxBtn = await screen.findByRole("button", { name: /Dropbox/i });
  fireEvent.click(dropboxBtn);

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "",
      100,
      "dropbox",
      "tag",
      ["subject:laptop"]
    );
  });
});

test("allows selecting and clearing tags in tag search mode", async () => {
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("tab", { name: "Tag Search" }));
  const laptopBtn = await screen.findByRole("button", { name: "laptop" });
  fireEvent.click(laptopBtn);

  expect(screen.getByLabelText("1 selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear selected tags" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Clear selected tags" }));
  expect(screen.queryByLabelText("1 selected")).not.toBeInTheDocument();
});


