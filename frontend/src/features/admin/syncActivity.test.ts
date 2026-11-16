import { expect, test } from "vitest";
import { emptyActivity, reduceSyncEvent } from "./syncActivity";
import type { SyncActivityEvent } from "../../types";
const event = (
  sequence: number,
  status: SyncActivityEvent["status"] = "indexing",
  filename: string | null = "same.jpg",
): SyncActivityEvent => ({
  sequence,
  status,
  filename,
  provider: "drive",
  detail: "private trace",
  terminal: false,
});
test("ordered statuses reconcile active names and reject duplicate or old sequences", () => {
  let state = reduceSyncEvent(emptyActivity(), event(1, "preparing"));
  state = reduceSyncEvent(state, event(2));
  expect(state.active[0]?.status).toBe("indexing");
  expect(reduceSyncEvent(state, event(1))).toBe(state);
  state = reduceSyncEvent(state, event(3, "indexed"));
  expect(state.active).toHaveLength(0);
  expect(state.recent).toHaveLength(1);
});
test("recent history is bounded and terminal events clear active work", () => {
  let state = emptyActivity();
  for (let i = 1; i < 70; i++)
    state = reduceSyncEvent(state, event(i, "indexed"));
  expect(state.recent).toHaveLength(50);
  state = reduceSyncEvent(state, event(70, "preparing", null));
  expect(state.active[0]?.filename).toBeNull();
  state = reduceSyncEvent(state, {
    sequence: 71,
    provider: "drive",
    terminal: true,
    detected_count: null,
    embedded_count: null,
    upserted: 0,
    deleted: 0,
    unchanged: 0,
    failed: 0,
  });
  expect(state.active).toHaveLength(0);
  expect(state.connection).toBe("finished");
});
test("same names in independent providers retain independent status", () => {
  const a = reduceSyncEvent(emptyActivity(), event(1));
  const b = reduceSyncEvent(emptyActivity(), {
    ...event(1, "indexed"),
    provider: "dropbox",
  });
  expect(a.active).toHaveLength(1);
  expect(b.active).toHaveLength(0);
});
