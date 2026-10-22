import { useEffect, useRef, useState } from "react";
import { ApiError, stopAdminSync, streamAdminSync } from "../../api/client";
import type { ControllerOptions } from "./admin.types";
import {
  emptyActivity,
  reduceSyncEvent,
  type ProviderActivityState,
} from "./syncActivity";
export function useProviderSync({
  enabled,
  onError,
  onComplete,
  onModelUnavailable,
}: ControllerOptions & {
  onComplete(provider: string): Promise<void>;
  onModelUnavailable(): void;
}) {
  const [activityByProvider, setActivity] = useState<
    Readonly<Record<string, ProviderActivityState>>
  >({});
  const [syncingProviders, setSyncing] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [stoppingProviders, setStopping] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const controllers = useRef(new Map<string, AbortController>());
  const stopping = useRef(new Set<string>());
  const callbacks = useRef({ onError, onComplete, onModelUnavailable });
  callbacks.current = { onError, onComplete, onModelUnavailable };
  const live = useRef(enabled);
  live.current = enabled;
  useEffect(() => {
    if (!enabled) {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
      stopping.current.clear();
      setActivity({});
      setSyncing(new Set());
      setStopping(new Set());
    }
    return () => {
      controllers.current.forEach((c) => c.abort());
      controllers.current.clear();
    };
  }, [enabled]);
  const owned = (id: string, c: AbortController) =>
    live.current && controllers.current.get(id) === c && !c.signal.aborted;
  async function start(id: string) {
    if (!enabled || controllers.current.has(id)) return;
    const c = new AbortController();
    controllers.current.set(id, c);
    setSyncing((s) => new Set(s).add(id));
    setActivity((s) => ({
      ...s,
      [id]: { ...emptyActivity(), connection: "streaming" },
    }));
    let complete = false;
    try {
      await streamAdminSync(
        id,
        (event) => {
          if (!owned(id, c)) return;
          if (event.terminal) complete = true;
          setActivity((s) => ({
            ...s,
            [id]: reduceSyncEvent(s[id] ?? emptyActivity(), event),
          }));
        },
        c.signal,
      );
      if (owned(id, c)) {
        setActivity((s) => ({
          ...s,
          [id]: {
            ...(s[id] ?? emptyActivity()),
            active: [],
            connection: complete ? "finished" : "interrupted",
          },
        }));
        await callbacks.current.onComplete(id);
      }
    } catch (e) {
      if (owned(id, c)) {
        setActivity((s) => ({
          ...s,
          [id]: {
            ...(s[id] ?? emptyActivity()),
            active: [],
            connection: "interrupted",
          },
        }));
        if (e instanceof ApiError && e.message === "Model not found")
          callbacks.current.onModelUnavailable();
        else callbacks.current.onError(e, "Provider sync failed. Try again.");
        if (!(e instanceof ApiError && e.status === 401) && owned(id, c))
          await callbacks.current.onComplete(id);
      }
    } finally {
      if (controllers.current.get(id) === c) {
        controllers.current.delete(id);
        setSyncing((s) => new Set([...s].filter((p) => p !== id)));
      }
    }
  }
  async function stop(id: string) {
    const c = controllers.current.get(id);
    if (!enabled || !c || stopping.current.has(id)) return;
    stopping.current.add(id);
    setStopping((s) => new Set(s).add(id));
    try {
      await stopAdminSync(id);
      if (owned(id, c)) {
        controllers.current.delete(id);
        c.abort();
        setSyncing((s) => new Set([...s].filter((p) => p !== id)));
        setActivity((s) => {
          const current = s[id] ?? emptyActivity();
          return {
            ...s,
            [id]: {
              ...current,
              active: [],
              recent: [
                ...current.active.map((e) => ({
                  ...e,
                  status: "stopped" as const,
                })),
                ...current.recent,
              ].slice(0, 50),
              connection: "stopped",
            },
          };
        });
        await callbacks.current.onComplete(id);
      }
    } catch (e) {
      if (owned(id, c))
        callbacks.current.onError(e, "Could not stop provider sync");
    } finally {
      stopping.current.delete(id);
      if (live.current)
        setStopping((s) => new Set([...s].filter((p) => p !== id)));
    }
  }
  return {
    activityByProvider,
    syncingProviders,
    stoppingProviders,
    connectionByProvider: Object.fromEntries(
      Object.entries(activityByProvider).map(([id, s]) => [id, s.connection]),
    ),
    start,
    stop,
  };
}
