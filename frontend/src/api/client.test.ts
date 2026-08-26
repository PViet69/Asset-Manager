import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  fetchThumbnail,
  refreshAdminProvider,
  streamAdminSync,
} from "./client";

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

test("posts provider refresh with admin credentials", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        provider: { provider: "dropbox" },
        embedding_model: { name: "embed", health: "ok" },
        description_model: { name: "describe", health: "ok" },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  await refreshAdminProvider("dropbox");

  expect(fetchMock).toHaveBeenCalledWith(
    "/admin/sync/dropbox/refresh",
    expect.objectContaining({ method: "POST", credentials: "include" })
  );
});

test("parses complete SSE frames", async () => {
  const payload = [
    'data: {"provider":"dropbox","sequence":1,"filename":"asset.png","status":"loading","detail":"Loading file","terminal":false}',
    'data: {"provider":"dropbox","sequence":2,"detected_count":1,"embedded_count":1,"upserted":1,"deleted":0,"unchanged":0,"failed":0,"terminal":true}',
  ].join("\n\n") + "\n\n";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(payload, { status: 200 })));
  const events: unknown[] = [];

  await streamAdminSync("dropbox", (event) => events.push(event), new AbortController().signal);

  expect(events).toHaveLength(2);
  expect(events[1]).toMatchObject({ terminal: true });
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
