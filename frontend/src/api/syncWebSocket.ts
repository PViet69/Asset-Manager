/**
 * WebSocket client for real-time sync job activity notifications.
 *
 * Connects to the backend WS endpoint and calls typed callbacks for each
 * event type: snapshot (initial state), activity (per-file update), and
 * terminal (job finished).
 */

import { config } from "../config";
import type {
  AdminSyncJobActivity,
  AdminSyncJobStatusResponse,
} from "../types";

// ---------------------------------------------------------------------------
// Message types
// ---------------------------------------------------------------------------

export type SyncWsSnapshotMessage = AdminSyncJobStatusResponse & {
  type: "snapshot";
};

export type SyncWsActivityMessage = {
  type: "activity";
  activity: AdminSyncJobActivity;
};

export type SyncWsTerminalMessage = {
  type: "terminal";
  state: "SUCCESS" | "FAILURE" | "REVOKED";
  embedded_delta: number;
  upserted: number;
  deleted: number;
  unchanged: number;
  failed: number;
  cancellation_requested: boolean;
  activity: readonly AdminSyncJobActivity[];
};

export type SyncWsErrorMessage = {
  type: "error";
  detail: string;
};

export type SyncWsMessage =
  | SyncWsSnapshotMessage
  | SyncWsActivityMessage
  | SyncWsTerminalMessage
  | SyncWsErrorMessage;

// ---------------------------------------------------------------------------
// Callbacks
// ---------------------------------------------------------------------------

export type SyncWsCallbacks = {
  onSnapshot: (data: SyncWsSnapshotMessage) => void;
  onActivity: (activity: AdminSyncJobActivity) => void;
  onTerminal: (data: SyncWsTerminalMessage) => void;
  onError: (detail?: string) => void;
  onClose: (code?: number) => void;
};

// ---------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------

/**
 * Open a WebSocket connection to stream sync job events for `jobId`.
 *
 * Returns a cleanup function that closes the connection.
 */
export function connectSyncJobWs(
  jobId: string,
  callbacks: SyncWsCallbacks,
): () => void {
  const base = config.apiBase || window.location.origin;
  const wsUrl =
    base.replace(/^http/, "ws") +
    `/admin/sync-jobs/${encodeURIComponent(jobId)}/ws`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event: MessageEvent): void => {
    let data: SyncWsMessage;
    try {
      data = JSON.parse(event.data as string) as SyncWsMessage;
    } catch {
      return;
    }

    switch (data.type) {
      case "snapshot":
        callbacks.onSnapshot(data);
        break;
      case "activity":
        callbacks.onActivity(data.activity);
        break;
      case "terminal":
        callbacks.onTerminal(data);
        break;
      case "error":
        callbacks.onError(data.detail);
        break;
    }
  };

  ws.onerror = (): void => {
    callbacks.onError();
  };

  ws.onclose = (event: CloseEvent): void => {
    callbacks.onClose(event.code);
  };

  return (): void => {
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }
  };
}
