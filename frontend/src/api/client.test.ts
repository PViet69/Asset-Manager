import { afterEach, expect, test, vi } from "vitest";

import {
  ApiError,
  deleteAdminQdrantPoint,
  fetchThumbnail,
  getAdminProviderItems,
  getApprovedTags,
  getProviders,
  getAdminSyncJob,
  refreshAdminProvider,
  triggerAdminSync,
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
    `/admin/sync/dropbox/refresh`,
    expect.objectContaining({ method: "POST", credentials: "include" })
  );
});

test("fetches providers from backend", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify([
        { id: "google_drive", display_name: "Google Drive" },
        { id: "dropbox", display_name: "Dropbox" },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  const providers = await getProviders();

  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("/v1/providers"),
    expect.any(Object)
  );
  expect(providers).toEqual([
    { id: "google_drive", displayName: "Google Drive" },
    { id: "dropbox", displayName: "Dropbox" },
  ]);
});

test("fetches approved tag groups from backend", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ groups: [{ category: "Subjects", tags: ["subject:laptop"] }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(getApprovedTags()).resolves.toEqual({
    groups: [{ category: "Subjects", tags: ["subject:laptop"] }],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/v1/search/tags",
    expect.objectContaining({ headers: expect.any(Headers) })
  );
});

test("queues provider sync with admin credentials", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ job_id: "job-1", provider: "dropbox", state: "PENDING" }),
      { status: 202, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(triggerAdminSync("dropbox")).resolves.toEqual({
    job_id: "job-1",
    provider: "dropbox",
    state: "PENDING",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/admin/sync/dropbox",
    expect.objectContaining({ method: "POST", credentials: "include" })
  );
});

test("fetches safe queued sync job status", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        job_id: "job-1",
        provider: "dropbox",
        state: "STARTED",
        attempt: 1,
        phase: "indexing",
        upserted: 2,
        deleted: 0,
        unchanged: 1,
        failed: 0,
        cancellation_requested: false,
        detail: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  await expect(getAdminSyncJob("job-1")).resolves.toMatchObject({
    job_id: "job-1",
    provider: "dropbox",
    state: "STARTED",
    phase: "indexing",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "/admin/sync-jobs/job-1",
    expect.objectContaining({ method: "GET", credentials: "include" })
  );
});

test("exposes conflicting sync job ID on ApiError", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ detail: { detail: "Dropbox sync already running", job_id: "job-active" } }),
        { status: 409, headers: { "Content-Type": "application/json" } }
      )
    )
  );

  await expect(triggerAdminSync("dropbox")).rejects.toMatchObject({
    status: 409,
    jobId: "job-active",
  });
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

test("posts delete embedded Qdrant item request", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        point_id: "point-123",
        deleted: 1,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await deleteAdminQdrantPoint("point-123");

  expect(fetchMock).toHaveBeenCalledWith(
    "/admin/sync/qdrant/delete/point-123",
    expect.objectContaining({ method: "POST", credentials: "include" })
  );
  expect(result).toEqual({ point_id: "point-123", deleted: 1 });
});

test("fetches embedded items for a provider", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        provider: "dropbox",
        items: [{ point_id: "point-1", filename: "photo.png" }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
  vi.stubGlobal("fetch", fetchMock);

  const result = await getAdminProviderItems("dropbox");

  expect(fetchMock).toHaveBeenCalledWith(
    `/admin/sync/dropbox/items`,
    expect.objectContaining({ method: "GET", credentials: "include" })
  );
  expect(result).toEqual({
    provider: "dropbox",
    items: [{ point_id: "point-1", filename: "photo.png" }],
  });
});




