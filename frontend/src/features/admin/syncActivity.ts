import type { SyncActivityEvent, SyncEvent } from "../../types";
export type ProviderActivityState = {
  lastSequence: number;
  active: readonly SyncActivityEvent[];
  recent: readonly SyncActivityEvent[];
  connection: "idle" | "streaming" | "finished" | "interrupted" | "stopped";
};
export const emptyActivity = (): ProviderActivityState => ({
  lastSequence: -1,
  active: [],
  recent: [],
  connection: "idle",
});
export function reduceSyncEvent(
  current: ProviderActivityState,
  event: SyncEvent,
): ProviderActivityState {
  if (event.sequence <= current.lastSequence) return current;
  if (event.terminal)
    return {
      ...current,
      lastSequence: event.sequence,
      active: [],
      connection: "finished",
    };
  const active = current.active.filter(
    (item) => item.filename !== event.filename,
  );
  const live = event.status === "preparing" || event.status === "indexing";
  return {
    lastSequence: event.sequence,
    active: live ? [...active, event] : active,
    recent: live ? current.recent : [event, ...current.recent].slice(0, 50),
    connection: event.status === "stopped" ? "stopped" : "streaming",
  };
}
