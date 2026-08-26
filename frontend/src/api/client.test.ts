import { afterEach, expect, test, vi } from "vitest";

import { ApiError, fetchThumbnail } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("fetches a thumbnail blob through the API base URL", async () => {
  // Arrange
  const thumbnail = new Blob(["image"], { type: "image/png" });
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(thumbnail, { status: 200, headers: { "Content-Type": "image/png" } })
  );
  vi.stubGlobal("fetch", fetchMock);

  // Act
  const result = await fetchThumbnail("/v1/storage/dropbox/id:photo/thumbnail");

  // Assert
  expect(fetchMock).toHaveBeenCalledWith(
    "/v1/storage/dropbox/id:photo/thumbnail",
    expect.objectContaining({ headers: expect.any(Headers) })
  );
  expect(result).toBeInstanceOf(Blob);
  expect(result.type).toBe("image/png");
});

test("maps a failed thumbnail response to ApiError", async () => {
  // Arrange
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ detail: "Thumbnail provider is unavailable" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      })
    )
  );

  // Act
  const request = fetchThumbnail("/v1/storage/dropbox/id:photo/thumbnail");

  // Assert
  await expect(request).rejects.toEqual(
    expect.objectContaining<ApiError>({
      name: "ApiError",
      status: 502,
      message: "Thumbnail provider is unavailable",
    })
  );
});
