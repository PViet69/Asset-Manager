import { useEffect, useRef, useState } from "react";
import { ApiError, stopAdminSync, triggerAdminSync } from "../../api/client";
import { connectSyncJobWs, type SyncWsTerminalMessage } from "../../api/syncWebSocket";
import type { AdminSyncJobActivity, SyncActivityEvent } from "../../types";
import type { ControllerOptions } from "./admin.types";
import {
  emptyActivity,
  reduceSyncEvent,
  type ProviderActivityState,
} from "./syncActivity";

const SAFE_SYNC_ERROR = "Provider sync failed. Try again.";

function toEvent(provider: string, activity: AdminSyncJobActivity): SyncActivityEvent {
  return {
    sequence: activity.sequence,
    provider,
    filename: activity.filename,
    status: activity.status,
    detail: "",
    terminal: false,
  };
}

function fromSnapshot(
  provider: string,
  activities: readonly AdminSyncJobActivity[],
): ProviderActivityState {
  return [...activities]
    .sort((a, b) => a.sequence - b.sequence)
    .reduce<ProviderActivityState>(
      (state, activity) => reduceSyncEvent(state, toEvent(provider, activity)),
      { ...emptyActivity(), connection: "streaming" as const },
    );
}

export function useProviderSync({
  enabled,
  onError,
  onComplete,
  onModelUnavailable,
  onProgress,
  onStatus,
}: ControllerOptions & {
  onComplete(provider: string): Promise<void>;
  onModelUnavailable(): void;
  onProgress(provider: string, delta: number): void;
  onStatus(message: string): void;
}) {
  const [activityByProvider, setActivity] = useState<
    Readonly<Record<string, ProviderActivityState>>
  >({});
  const [syncJobIdsByProvider, setSyncJobIds] = useState<Readonly<Record<string, string>>>({});
  const [syncingProviders, setSyncing] = useState<ReadonlySet<string>>(new Set());
  const [stoppingProviders, setStopping] = useState<ReadonlySet<string>>(new Set());
  const callbacks = useRef({ onError, onComplete, onModelUnavailable, onProgress, onStatus });
  callbacks.current = { onError, onComplete, onModelUnavailable, onProgress, onStatus };
  const live = useRef(enabled);
  live.current = enabled;
  const jobs = useRef<Readonly<Record<string, string>>>({});
  jobs.current = syncJobIdsByProvider;
  const starting = useRef(new Set<string>());
  const stopping = useRef(new Set<string>());
  const lastSequence = useRef(new Map<string, number>());
  const lastEmbeddedDelta = useRef(new Map<string, number>());

  useEffect(() => {
    if (!enabled) {
      jobs.current = {};
      starting.current.clear();
      stopping.current.clear();
      lastSequence.current.clear();
      lastEmbeddedDelta.current.clear();
      setSyncJobIds({});
      setActivity({});
      setSyncing(new Set());
      setStopping(new Set());
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    function finish(provider: string, jobId: string, data: SyncWsTerminalMessage) {
      if (!active || !live.current || jobs.current[provider] !== jobId) return;
      const previous = lastEmbeddedDelta.current.get(jobId);
      if (previous !== undefined && previous >= 0) {
        const delta = Math.max(0, data.embedded_delta - previous);
        if (delta > 0) callbacks.current.onProgress(provider, delta);
      }
      lastSequence.current.delete(jobId);
      lastEmbeddedDelta.current.delete(jobId);
      setSyncJobIds((current) => {
        const { [provider]: _, ...remaining } = current;
        jobs.current = remaining;
        return remaining;
      });
      setSyncing((current) => new Set([...current].filter((id) => id !== provider)));
      setActivity((current) => {
        let state = current[provider] ?? emptyActivity();
        for (const activity of data.activity) {
          state = reduceSyncEvent(state, toEvent(provider, activity));
        }
        return {
          ...current,
          [provider]: {
            ...state,
            active: [],
            connection: data.state === "REVOKED" ? "stopped" : "finished",
          },
        };
      });
      stopping.current.delete(provider);
      setStopping((current) => new Set([...current].filter((id) => id !== provider)));
      if (data.state === "FAILURE") callbacks.current.onError(new Error(SAFE_SYNC_ERROR), SAFE_SYNC_ERROR);
      else if (data.state === "REVOKED") callbacks.current.onStatus("Provider sync stopped.");
      void callbacks.current.onComplete(provider);
    }
    const cleanups = Object.entries(syncJobIdsByProvider).map(([provider, jobId]) =>
      connectSyncJobWs(jobId, {
        onSnapshot(data) {
          if (!active || !live.current || jobs.current[provider] !== jobId) return;
          if (data.state === "SUCCESS" || data.state === "FAILURE" || data.state === "REVOKED") {
            finish(provider, jobId, { ...data, type: "terminal", state: data.state, embedded_delta: data.embedded_delta ?? 0 });
            return;
          }
          const events = [...data.activity].sort((a, b) => a.sequence - b.sequence);
          const maxSequence = events.reduce((max, activity) => Math.max(max, activity.sequence), -1);
          lastSequence.current.set(jobId, maxSequence);
          setActivity((current) => ({
            ...current,
            [provider]: fromSnapshot(provider, events),
          }));
          const cumulativeDelta = data.embedded_delta ?? 0;
          const previous = lastEmbeddedDelta.current.get(jobId);
          if (previous === undefined || previous === -1) {
            lastEmbeddedDelta.current.set(jobId, cumulativeDelta);
          } else {
            const delta = Math.max(0, cumulativeDelta - previous);
            lastEmbeddedDelta.current.set(jobId, cumulativeDelta);
            if (delta > 0) callbacks.current.onProgress(provider, delta);
          }
        },
        onActivity(activity) {
          if (!active || !live.current || jobs.current[provider] !== jobId) return;
          const previousSequence = lastSequence.current.get(jobId) ?? -1;
          if (activity.sequence <= previousSequence) return;
          lastSequence.current.set(jobId, activity.sequence);
          setActivity((current) => ({
            ...current,
            [provider]: reduceSyncEvent(
              current[provider] ?? emptyActivity(),
              toEvent(provider, activity),
            ),
          }));
          if (activity.status === "indexed" && activity.embedded_delta === 1) {
            lastEmbeddedDelta.current.set(
              jobId,
              Math.max(0, lastEmbeddedDelta.current.get(jobId) ?? 0) + 1,
            );
            callbacks.current.onProgress(provider, 1);
          }
        },
        onTerminal(data) { finish(provider, jobId, data); },
        onError(detail) {
          if (!active || !live.current || jobs.current[provider] !== jobId) return;
          if (detail === "Job not found") {
            lastSequence.current.delete(jobId);
            lastEmbeddedDelta.current.delete(jobId);
            setSyncJobIds((current) => {
              const { [provider]: _, ...remaining } = current;
              jobs.current = remaining;
              return remaining;
            });
            setSyncing((current) => new Set([...current].filter((id) => id !== provider)));
            callbacks.current.onStatus("Sync status expired. Refresh status to confirm results.");
          }
        },
        onClose(code) {
          if (!active || !live.current || jobs.current[provider] !== jobId) return;
          if (code === 4404) {
            lastSequence.current.delete(jobId);
            lastEmbeddedDelta.current.delete(jobId);
            setSyncJobIds((current) => {
              const { [provider]: _, ...remaining } = current;
              jobs.current = remaining;
              return remaining;
            });
            setSyncing((current) => new Set([...current].filter((id) => id !== provider)));
            callbacks.current.onStatus("Sync status expired. Refresh status to confirm results.");
          }
        },
      }),
    );
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [enabled, syncJobIdsByProvider]);

  async function start(provider: string) {
    if (!enabled || jobs.current[provider] || starting.current.has(provider)) return;
    starting.current.add(provider);
    setSyncing((current) => new Set(current).add(provider));
    setActivity((current) => ({
      ...current,
      [provider]: { ...emptyActivity(), connection: "streaming" },
    }));
    try {
      const queued = await triggerAdminSync(provider);
      lastSequence.current.delete(queued.job_id);
      lastEmbeddedDelta.current.set(queued.job_id, 0);
      const next = { ...jobs.current, [provider]: queued.job_id };
      jobs.current = next;
      setSyncJobIds(next);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.jobId) {
        lastSequence.current.delete(error.jobId);
        lastEmbeddedDelta.current.set(error.jobId, -1);
        const next = { ...jobs.current, [provider]: error.jobId };
        jobs.current = next;
        setSyncJobIds(next);
      } else {
        setSyncing((current) => new Set([...current].filter((id) => id !== provider)));
        if (error instanceof ApiError && error.message === "Model not found")
          callbacks.current.onModelUnavailable();
        else callbacks.current.onError(error, SAFE_SYNC_ERROR);
      }
    } finally {
      starting.current.delete(provider);
    }
  }

  async function stop(provider: string) {
    if (!enabled || !jobs.current[provider] || stopping.current.has(provider)) return;
    stopping.current.add(provider);
    setStopping((current) => new Set(current).add(provider));
    try {
      await stopAdminSync(provider);
    } catch (error) {
      stopping.current.delete(provider);
      setStopping((current) => new Set([...current].filter((id) => id !== provider)));
      callbacks.current.onError(error, "Could not stop provider sync");
    }
  }

  return { activityByProvider, syncingProviders, stoppingProviders, start, stop };
}
