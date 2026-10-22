import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import * as api from "../../api/client";
import type { SyncEvent } from "../../types";
import { useProviderSync } from "./useProviderSync";
import { useAdminDashboard } from "./useAdminDashboard";
import { useProviderItems } from "./useProviderItems";
vi.mock("../../api/client", () => ({
  ApiError: class extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
  getAdminSyncStatus: vi.fn(),
  refreshAdminProvider: vi.fn(),
  streamAdminSync: vi.fn(),
  stopAdminSync: vi.fn(),
  getAdminProviderItems: vi.fn(),
  deleteAdminQdrantPoint: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const common = {
  onError: vi.fn(),
  onComplete: vi.fn().mockResolvedValue(undefined),
  onModelUnavailable: vi.fn(),
};
test("disable aborts active stream and ignores late events from a replaced controller", async () => {
  let emit!: (e: SyncEvent) => void;
  let signal!: AbortSignal;
  vi.mocked(api.streamAdminSync).mockImplementation(async (_id, cb, s) => {
    emit = cb;
    signal = s!;
    await new Promise(() => {});
  });
  const { result, rerender } = renderHook(
    ({ enabled }) => useProviderSync({ ...common, enabled }),
    { initialProps: { enabled: true } },
  );
  await act(async () => {
    void result.current.start("drive");
  });
  rerender({ enabled: false });
  expect(signal.aborted).toBe(true);
  await act(async () =>
    emit({
      sequence: 1,
      provider: "drive",
      filename: "late.jpg",
      status: "indexing",
      detail: "",
      terminal: false,
    }),
  );
  expect(result.current.activityByProvider).toEqual({});
});
test("unmount aborts streams", async () => {
  let signal!: AbortSignal;
  vi.mocked(api.streamAdminSync).mockImplementation(async (_id, _cb, s) => {
    signal = s!;
    await new Promise(() => {});
  });
  const { result, unmount } = renderHook(() =>
    useProviderSync({ ...common, enabled: true }),
  );
  await act(async () => {
    void result.current.start("drive");
  });
  unmount();
  expect(signal.aborted).toBe(true);
});
test("late provider items response after logout is ignored", async () => {
  let resolve!: (r: {
    provider: string;
    items: { point_id: string }[];
  }) => void;
  vi.mocked(api.getAdminProviderItems).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const { result, rerender } = renderHook(
    ({ enabled }) =>
      useProviderItems({ enabled, onError: vi.fn(), onDeleted: vi.fn() }),
    { initialProps: { enabled: true } },
  );
  await act(async () => {
    void result.current.open("drive");
  });
  rerender({ enabled: false });
  await act(async () =>
    resolve({ provider: "drive", items: [{ point_id: "secret" }] }),
  );
  expect(result.current.itemsByProvider).toEqual({});
  expect(result.current.openProvider).toBeNull();
});
test("delete failure retains item and pending confirmation", async () => {
  vi.mocked(api.getAdminProviderItems).mockResolvedValue({
    provider: "drive",
    items: [{ point_id: "point", filename: "photo.jpg" }],
  });
  vi.mocked(api.deleteAdminQdrantPoint).mockRejectedValue(new Error("Offline"));
  const onError = vi.fn();
  const { result } = renderHook(() =>
    useProviderItems({ enabled: true, onError, onDeleted: vi.fn() }),
  );
  await act(async () => result.current.open("drive"));
  act(() =>
    result.current.requestDelete("drive", {
      point_id: "point",
      filename: "photo.jpg",
    }),
  );
  await act(async () => result.current.confirmDelete());
  expect(result.current.itemsByProvider.drive).toHaveLength(1);
  expect(result.current.pendingDeletion?.item.point_id).toBe("point");
  expect(onError).toHaveBeenCalled();
});
test("stop failure retains live work and interrupted connection clears it", async () => {
  let emit!: (e: SyncEvent) => void;
  let reject!: (e: Error) => void;
  vi.mocked(api.streamAdminSync).mockImplementation(async (_id, cb) => {
    emit = cb;
    await new Promise<void>((_r, j) => {
      reject = j;
    });
  });
  vi.mocked(api.stopAdminSync).mockRejectedValue(new Error("Cannot stop"));
  const { result } = renderHook(() =>
    useProviderSync({ ...common, enabled: true }),
  );
  await act(async () => {
    void result.current.start("drive");
  });
  await act(async () =>
    emit({
      sequence: 1,
      provider: "drive",
      filename: "live.mp4",
      status: "indexing",
      detail: "",
      terminal: false,
    }),
  );
  await act(async () => result.current.stop("drive"));
  expect(result.current.syncingProviders.has("drive")).toBe(true);
  expect(result.current.activityByProvider.drive?.active).toHaveLength(1);
  await act(async () => reject(new Error("Disconnected")));
  await waitFor(() =>
    expect(result.current.activityByProvider.drive?.connection).toBe(
      "interrupted",
    ),
  );
  expect(result.current.activityByProvider.drive?.active).toHaveLength(0);
});
const provider = (count: number, id = "drive") => ({
  provider: id,
  display_name: id,
  enabled: true,
  health: "ok",
  detected_count: 20,
  embedded_count: count,
});
const status = (count: number) => ({
  providers: [provider(count)],
  embedding_model: { name: "embed", health: "ok" },
  description_model: { name: "describe", health: "ok" },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
test("partial non-auth stream failure reloads authoritative status and preserves interruption", async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  vi.mocked(api.streamAdminSync).mockImplementation(async (id, emit) => {
    emit({
      sequence: 1,
      provider: id,
      filename: "indexed.jpg",
      status: "indexed",
      detail: "",
      terminal: false,
    });
    throw new Error("Disconnected after indexing");
  });
  const { result } = renderHook(() =>
    useProviderSync({ ...common, onComplete: complete, enabled: true }),
  );
  await act(async () => result.current.start("drive"));
  expect(complete).toHaveBeenCalledWith("drive");
  expect(result.current.activityByProvider.drive?.connection).toBe(
    "interrupted",
  );
  expect(result.current.activityByProvider.drive?.recent[0]?.filename).toBe(
    "indexed.jpg",
  );
});
test("older dashboard reload cannot replace newer authoritative counts", async () => {
  const older = deferred<ReturnType<typeof status>>();
  const newer = deferred<ReturnType<typeof status>>();
  vi.mocked(api.getAdminSyncStatus)
    .mockReturnValueOnce(older.promise)
    .mockReturnValueOnce(newer.promise);
  const { result } = renderHook(() =>
    useAdminDashboard({ enabled: true, onUnauthorized: vi.fn() }),
  );
  let next!: Promise<void>;
  act(() => {
    next = result.current.reload();
  });
  await act(async () => {
    newer.resolve(status(19));
    await next;
  });
  expect(result.current.dashboard.providers[0]?.embedded_count).toBe(19);
  await act(async () => older.resolve(status(10)));
  expect(result.current.dashboard.providers[0]?.embedded_count).toBe(19);
});
test("older full reload cannot overwrite a newer provider refresh", async () => {
  vi.mocked(api.getAdminSyncStatus).mockResolvedValueOnce(status(10));
  const old = deferred<ReturnType<typeof status>>();
  vi.mocked(api.getAdminSyncStatus).mockReturnValueOnce(old.promise);
  vi.mocked(api.refreshAdminProvider).mockResolvedValue({
    provider: provider(19),
    embedding_model: { name: "new-embed", health: "ok" },
    description_model: { name: "describe", health: "ok" },
  });
  const { result } = renderHook(() =>
    useAdminDashboard({ enabled: true, onUnauthorized: vi.fn() }),
  );
  await waitFor(() =>
    expect(result.current.dashboard.providers).toHaveLength(1),
  );
  act(() => {
    void result.current.reload();
  });
  await act(async () => result.current.refreshProvider("drive"));
  await act(async () => old.resolve(status(11)));
  expect(result.current.dashboard.providers[0]?.embedded_count).toBe(19);
  expect(result.current.dashboard.embeddingModel?.name).toBe("new-embed");
});
test("older provider refresh cannot overwrite a newer full reload", async () => {
  vi.mocked(api.getAdminSyncStatus)
    .mockResolvedValueOnce(status(10))
    .mockResolvedValueOnce(status(19));
  const old = deferred<Awaited<ReturnType<typeof api.refreshAdminProvider>>>();
  vi.mocked(api.refreshAdminProvider).mockReturnValue(old.promise);
  const { result } = renderHook(() =>
    useAdminDashboard({ enabled: true, onUnauthorized: vi.fn() }),
  );
  await waitFor(() =>
    expect(result.current.dashboard.providers).toHaveLength(1),
  );
  act(() => {
    void result.current.refreshProvider("drive");
  });
  await act(async () => result.current.reload());
  await act(async () =>
    old.resolve({
      provider: provider(11),
      embedding_model: { name: "old", health: "ok" },
      description_model: { name: "old", health: "ok" },
    }),
  );
  expect(result.current.dashboard.providers[0]?.embedded_count).toBe(19);
  expect(result.current.dashboard.embeddingModel?.name).toBe("embed");
});
test("parallel provider refreshes retain both providers newest independent counts", async () => {
  vi.mocked(api.getAdminSyncStatus).mockResolvedValue({
    ...status(10),
    providers: [provider(10), provider(3, "dropbox")],
  });
  const drive =
    deferred<Awaited<ReturnType<typeof api.refreshAdminProvider>>>();
  const dropbox =
    deferred<Awaited<ReturnType<typeof api.refreshAdminProvider>>>();
  vi.mocked(api.refreshAdminProvider).mockImplementation((id) =>
    id === "drive" ? drive.promise : dropbox.promise,
  );
  const { result } = renderHook(() =>
    useAdminDashboard({ enabled: true, onUnauthorized: vi.fn() }),
  );
  await waitFor(() =>
    expect(result.current.dashboard.providers).toHaveLength(2),
  );
  act(() => {
    void result.current.refreshProvider("drive");
    void result.current.refreshProvider("dropbox");
  });
  await act(async () =>
    dropbox.resolve({
      provider: provider(8, "dropbox"),
      embedding_model: { name: "newest", health: "ok" },
      description_model: { name: "describe", health: "ok" },
    }),
  );
  await act(async () =>
    drive.resolve({
      provider: provider(19),
      embedding_model: { name: "older", health: "ok" },
      description_model: { name: "describe", health: "ok" },
    }),
  );
  expect(
    result.current.dashboard.providers.map((p) => p.embedded_count),
  ).toEqual([19, 8]);
  expect(result.current.dashboard.embeddingModel?.name).toBe("newest");
});
test("unauthorized stream failure expires without requesting protected status again", async () => {
  const complete = vi.fn();
  vi.mocked(api.streamAdminSync).mockRejectedValue(
    new api.ApiError(401, "Session expired"),
  );
  const { result } = renderHook(() =>
    useProviderSync({ ...common, onComplete: complete, enabled: true }),
  );
  await act(async () => result.current.start("drive"));
  expect(complete).not.toHaveBeenCalled();
});
