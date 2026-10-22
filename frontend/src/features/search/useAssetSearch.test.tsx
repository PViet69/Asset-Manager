import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { searchVectors } from "../../api/client";
import { useAssetSearch } from "./useAssetSearch";
vi.mock("../../api/client", () => ({
  ApiError: class extends Error {},
  getProviders: vi.fn().mockResolvedValue([]),
  getApprovedTags: vi.fn().mockResolvedValue({ groups: [] }),
  searchVectors: vi.fn().mockResolvedValue({ data: [] }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});
test.each([
  ["0", 1],
  ["101", 100],
  ["bad", 10],
  [undefined, 10],
])("semantic submit clamps %s to %s", async (externalTopK, limit) => {
  const { result } = renderHook(() => useAssetSearch({ externalTopK }));
  act(() => result.current.setQuery(" asset "));
  await act(() => result.current.submit());
  expect(searchVectors).toHaveBeenCalledWith(
    "asset",
    limit,
    undefined,
    "semantic",
  );
});
test("filename waits 150ms and requests limit 100", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useAssetSearch());
  act(() => result.current.setMode("filename"));
  act(() => result.current.setQuery("asset"));
  await act(() => vi.advanceTimersByTimeAsync(149));
  expect(searchVectors).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(searchVectors).toHaveBeenCalledWith(
    "asset",
    100,
    undefined,
    "filename",
  );
});
test("4191 characters never submits", async () => {
  const { result } = renderHook(() => useAssetSearch());
  act(() => result.current.setQuery("x".repeat(4191)));
  await act(() => result.current.submit());
  expect(searchVectors).not.toHaveBeenCalled();
});
test.each(["mode", "filter"])(
  "%s switch discards pending response",
  async (kind) => {
    let resolve!: (value: any) => void;
    vi.mocked(searchVectors).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useAssetSearch());
    act(() => result.current.setQuery("asset"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.submit();
    });
    act(() => {
      if (kind === "mode") result.current.setMode("filename");
      else result.current.applyFilters({ provider: "dropbox", tags: [] });
    });
    await act(async () => {
      resolve({ data: [{ filename: "stale" }] });
      await pending;
    });
    expect(result.current.sortedItems).toEqual([]);
  },
);
test("semantic preserves relevance order and date sorts preserve missing-date behavior", async () => {
  const data = [
    { point_id: "a", modified_time: "2025-01-01" },
    { point_id: "b", modified_time: null },
    { point_id: "c", modified_time: "invalid" },
    { point_id: "d", modified_time: "2026-01-01" },
  ] as any;
  vi.mocked(searchVectors).mockResolvedValue({ object: "list", data });
  const { result } = renderHook(() => useAssetSearch());
  act(() => result.current.setQuery("asset"));
  await act(() => result.current.submit());
  act(() => result.current.setSort("date_desc"));
  expect(result.current.sortedItems.map((x) => x.point_id)).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  act(() => result.current.setMode("filename"));
  act(() => result.current.setQuery("asset"));
  await act(() => result.current.submit());
  act(() => result.current.setSort("date_desc"));
  expect(result.current.sortedItems.map((x) => x.point_id)).toEqual([
    "d",
    "a",
    "b",
    "c",
  ]);
  act(() => result.current.setSort("date_asc"));
  expect(result.current.sortedItems.map((x) => x.point_id)).toEqual([
    "b",
    "c",
    "a",
    "d",
  ]);
});

test("explicit filename submit before debounce does not restart loading or send a duplicate request", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useAssetSearch());
  act(() => result.current.setMode("filename"));
  act(() => result.current.setQuery("asset"));
  await act(() => result.current.submit());
  expect(result.current.state.kind).toBe("result");
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(searchVectors).toHaveBeenCalledTimes(1);
  expect(result.current.state.kind).toBe("result");
});

test("editing a pending semantic query leaves loading and ignores its stale response", async () => {
  let resolve!: (value: any) => void;
  vi.mocked(searchVectors).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result } = renderHook(() => useAssetSearch());
  act(() => result.current.setQuery("original"));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.submit();
  });
  expect(result.current.state.kind).toBe("submitting");
  act(() => result.current.setQuery("edited"));
  expect(result.current.state.kind).toBe("idle");
  await act(async () => {
    resolve({ data: [{ filename: "stale" }] });
    await pending;
  });
  expect(result.current.state.kind).toBe("idle");
  expect(result.current.sortedItems).toEqual([]);
  expect(searchVectors).toHaveBeenCalledTimes(1);
});
