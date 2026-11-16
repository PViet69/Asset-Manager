import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { SyncActivityPanel } from "./SyncActivityPanel";
import { emptyActivity, reduceSyncEvent } from "./syncActivity";
afterEach(cleanup);
test("filename-only image and video events expose honest icons without fetching thumbnails or raw details", () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  let state = reduceSyncEvent(emptyActivity(), {
    sequence: 1,
    provider: "drive",
    filename: "photo.jpg",
    status: "indexing",
    detail: "SECRET",
    terminal: false,
  });
  state = reduceSyncEvent(state, {
    sequence: 2,
    provider: "drive",
    filename: "movie.mp4",
    status: "preparing",
    detail: "TRACE",
    terminal: false,
  });
  render(<SyncActivityPanel providers={[]} activity={{ drive: state }} />);
  expect(screen.getByText("photo.jpg")).toBeInTheDocument();
  expect(screen.getByText("movie.mp4")).toBeInTheDocument();
  expect(screen.getByLabelText("Image")).toBeInTheDocument();
  expect(screen.getByLabelText("Video")).toBeInTheDocument();
  expect(screen.queryByText("SECRET")).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});
test("interrupted connections display no stale active files", () => {
  render(
    <SyncActivityPanel
      providers={[]}
      activity={{ drive: { ...emptyActivity(), connection: "interrupted" } }}
    />,
  );
  expect(screen.getByText(/Connection interrupted/)).toBeInTheDocument();
  expect(
    screen.getByText("No files are currently being indexed."),
  ).toBeInTheDocument();
});
