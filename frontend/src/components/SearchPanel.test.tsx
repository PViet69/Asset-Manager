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
  fireEvent.submit(screen.getByLabelText("Query").closest("form")!);

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
  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Provider" }));
  const providerBtn = await screen.findByRole("option", { name: /Google Drive/i });
  fireEvent.click(providerBtn);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.submit(screen.getByLabelText("Query").closest("form")!);

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

test("keeps tag filters collapsed until opened from search box", async () => {
  render(<SearchPanel />);

  expect(screen.queryByRole("button", { name: "Tags" })).not.toBeInTheDocument();
  const toggle = screen.getByRole("button", { name: "Tag filters" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");

  fireEvent.click(toggle);

  expect(await screen.findByRole("button", { name: "Tags" })).toBeInTheDocument();
  expect(screen.getByRole("dialog", { name: "Filter by tags" })).toBeInTheDocument();
  expect(toggle).toHaveAttribute("aria-expanded", "true");
});

test("sends selected tags as semantic search filters", async () => {
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
  fireEvent.click(await screen.findByRole("option", { name: /laptop/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "laptop" },
  });
  fireEvent.submit(screen.getByLabelText("Query").closest("form")!);

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "laptop", 10, undefined, "semantic", ["subject:laptop"]
    );
  });
});


test("keeps tag filters available for filename search", async () => {
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("tab", { name: "Filename Search" }));
  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
  fireEvent.click(await screen.findByRole("option", { name: /laptop/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "laptop.png" },
  });

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "laptop.png", 100, undefined, "filename", ["subject:laptop"]
    );
  });
});


test("does not show tag search mode", () => {
  render(<SearchPanel />);

  expect(screen.queryByRole("tab", { name: "Tag Search" })).not.toBeInTheDocument();
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
  fireEvent.submit(screen.getByLabelText("Query").closest("form")!);

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
  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Provider" }));
  const gdriveBtn = await screen.findByRole("option", { name: /Google Drive/i });
  fireEvent.click(gdriveBtn);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

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

test("re-triggers semantic search with tag filters when changing provider", async () => {
  mockedSearchVectors.mockResolvedValue({ object: "list", data: [] });
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
  fireEvent.click(await screen.findByRole("option", { name: /laptop/i }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  fireEvent.change(screen.getByLabelText("Query"), {
    target: { value: "laptop" },
  });
  fireEvent.submit(screen.getByLabelText("Query").closest("form")!);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(screen.getByRole("button", { name: "Provider" }));
  const dropboxBtn = await screen.findByRole("option", { name: /Dropbox/i });
  fireEvent.click(dropboxBtn);
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

  await waitFor(() => {
    expect(mockedSearchVectors).toHaveBeenCalledWith(
      "laptop", 10, "dropbox", "semantic", ["subject:laptop"]
    );
  });
});

test("allows selecting and clearing tag filters", async () => {
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  fireEvent.click(await screen.findByRole("button", { name: "Tags" }));
  const laptopBtn = await screen.findByRole("option", { name: /laptop/i });
  fireEvent.click(laptopBtn);

  expect(screen.getByLabelText("1 selected")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reset" }));
  expect(screen.queryByLabelText("1 selected")).not.toBeInTheDocument();
});

test("renders provider dropdown with Google Drive style select and options", async () => {
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  const trigger = await screen.findByRole("button", { name: "Provider" });
  expect(trigger).toHaveTextContent("Any");

  // Open dropdown
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox", { name: "Provider" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Any" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Google Drive/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /Dropbox/i })).toBeInTheDocument();

  // Select Dropbox
  fireEvent.click(screen.getByRole("option", { name: /Dropbox/i }));
  expect(screen.queryByRole("listbox", { name: "Provider" })).not.toBeInTheDocument();
  expect(trigger).toHaveTextContent("Dropbox");
});

test("renders tags dropdown with Google Drive style select and options", async () => {
  render(<SearchPanel />);

  fireEvent.click(screen.getByRole("button", { name: "Tag filters" }));
  const trigger = await screen.findByRole("button", { name: "Tags" });
  expect(trigger).toHaveTextContent("Any");

  // Open dropdown
  fireEvent.click(trigger);
  expect(screen.getByRole("listbox", { name: "Tags" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "Any" })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /laptop/i })).toBeInTheDocument();

  // Select laptop tag
  fireEvent.click(screen.getByRole("option", { name: /laptop/i }));
  expect(trigger).toHaveTextContent("laptop");
});


