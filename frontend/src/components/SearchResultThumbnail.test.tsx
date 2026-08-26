import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { fetchThumbnail } from "../api/client";
import { SearchResultThumbnail } from "./SearchResultThumbnail";

vi.mock("../api/client", () => ({ fetchThumbnail: vi.fn() }));

const mockedFetchThumbnail = vi.mocked(fetchThumbnail);
let observerCallback: IntersectionObserverCallback | undefined;

function installObserver(): void {
  class TestIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      observerCallback = callback;
    }

    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
    root = null;
    rootMargin = "";
    thresholds = [];
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
}

function triggerVisible(): void {
  observerCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

function mockObjectUrls(): { create: ReturnType<typeof vi.fn>; revoke: ReturnType<typeof vi.fn> } {
  const create = vi.fn();
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
  return { create, revoke };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  mockedFetchThumbnail.mockReset();
  observerCallback = undefined;
});

test("fetches thumbnail after result enters viewport", async () => {
  installObserver();
  mockedFetchThumbnail.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  mockObjectUrls().create.mockReturnValue("blob:preview");

  render(
    <SearchResultThumbnail
      thumbnailUrl="/v1/storage/dropbox/id/thumbnail"
      filename="photo.png"
    />
  );
  triggerVisible();

  expect(await screen.findByRole("img", { name: "Thumbnail for photo.png" }))
    .toHaveAttribute("src", "blob:preview");
  expect(mockedFetchThumbnail).toHaveBeenCalledWith("/v1/storage/dropbox/id/thumbnail");
});

test("keeps file icon when thumbnail request fails", async () => {
  installObserver();
  mockedFetchThumbnail.mockRejectedValue(new Error("unavailable"));

  render(
    <SearchResultThumbnail
      thumbnailUrl="/v1/storage/dropbox/id/thumbnail"
      filename="photo.png"
    />
  );
  triggerVisible();

  await waitFor(() => expect(mockedFetchThumbnail).toHaveBeenCalledOnce());
  expect(screen.getByLabelText("File thumbnail unavailable")).toBeInTheDocument();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});

test("fetches immediately when IntersectionObserver is unavailable", async () => {
  mockedFetchThumbnail.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  mockObjectUrls().create.mockReturnValue("blob:preview");

  render(
    <SearchResultThumbnail
      thumbnailUrl="/v1/storage/dropbox/id/thumbnail"
      filename="photo.png"
    />
  );

  expect(await screen.findByRole("img", { name: "Thumbnail for photo.png" }))
    .toHaveAttribute("src", "blob:preview");
});

test("revokes previous object URL when thumbnail URL changes", async () => {
  // Arrange
  mockedFetchThumbnail.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const { create, revoke } = mockObjectUrls();
  create.mockReturnValueOnce("blob:first").mockReturnValueOnce("blob:second");
  const view = render(
    <SearchResultThumbnail thumbnailUrl="/v1/storage/dropbox/first/thumbnail" filename="photo.png" />
  );

  // Act
  await screen.findByRole("img", { name: "Thumbnail for photo.png" });
  view.rerender(
    <SearchResultThumbnail thumbnailUrl="/v1/storage/dropbox/second/thumbnail" filename="photo.png" />
  );
  await waitFor(() => expect(mockedFetchThumbnail).toHaveBeenLastCalledWith("/v1/storage/dropbox/second/thumbnail"));

  // Assert
  expect(revoke).toHaveBeenCalledWith("blob:first");
});

test("revokes thumbnail object URL when component unmounts", async () => {
  installObserver();
  mockedFetchThumbnail.mockResolvedValue(new Blob(["image"], { type: "image/png" }));
  const { create, revoke } = mockObjectUrls();
  create.mockReturnValue("blob:preview");

  const view = render(
    <SearchResultThumbnail
      thumbnailUrl="/v1/storage/dropbox/id/thumbnail"
      filename="photo.png"
    />
  );
  triggerVisible();
  await screen.findByRole("img", { name: "Thumbnail for photo.png" });
  view.unmount();

  expect(revoke).toHaveBeenCalledWith("blob:preview");
});
