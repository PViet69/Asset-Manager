import { config } from "../config";
import type {
  AdminAccount,
  AdminDashboardStatusResponse,
  AdminProviderRefreshResponse,
  AdminSyncResponse,
  SyncEvent,
  VectorSearchResponse,
} from "../types";

export class ApiError extends Error {
  public readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function buildHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  if (config.apiKey !== undefined && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${config.apiKey}`);
  }
  return headers;
}

async function parseError(res: Response): Promise<never> {
  let message = `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.length > 0) {
      message = body.detail;
    } else if (body.detail && typeof body.detail === "object") {
      message = JSON.stringify(body.detail);
    }
  } catch {
    // Keep status-based message when response body is not JSON.
  }
  throw new ApiError(res.status, message);
}

async function postJson<T>(
  path: string,
  body: unknown,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    ...options,
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json", ...options.headers }),
    body: JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as T;
}

export function searchVectors(
  query: string,
  limit: number = 10,
  provider?: "google_drive" | "dropbox"
): Promise<VectorSearchResponse> {
  const body = provider === undefined ? { query, limit } : { query, limit, provider };
  return postJson<VectorSearchResponse>("/v1/search", body);
}

export async function fetchThumbnail(path: string): Promise<Blob> {
  const res = await fetch(`${config.apiBase}${path}`, { headers: buildHeaders() });
  if (!res.ok) await parseError(res);
  return res.blob();
}

export function loginAdmin(
  username: string,
  password: string
): Promise<AdminAccount> {
  return postJson<AdminAccount>("/auth/login", { username, password }, {
    credentials: "include",
  });
}
export async function getAdminSession(): Promise<AdminAccount> {
  const res = await fetch(`${config.apiBase}/auth/me`, { credentials: "include" });
  if (!res.ok) await parseError(res);
  return (await res.json()) as AdminAccount;
}

async function adminRequest<T>(
  path: string,
  method: "GET" | "POST" = "GET"
): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    method,
    credentials: "include",
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as T;
}

export function getAdminSyncStatus(): Promise<AdminDashboardStatusResponse> {
  return adminRequest("/admin/sync/status");
}

export function refreshAdminProvider(
  provider: string
): Promise<AdminProviderRefreshResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}/refresh`, "POST");
}

export async function streamAdminSync(
  provider: string,
  onEvent: (event: SyncEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const response = await fetch(
    `${config.apiBase}/admin/sync/${encodeURIComponent(provider)}/stream`,
    { method: "POST", credentials: "include", signal }
  );
  if (!response.ok) await parseError(response);
  if (response.body === null) throw new ApiError(response.status, "Sync stream is unavailable");

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += value ?? "";
      let separator = pending.indexOf("\n\n");
      while (separator >= 0) {
        const frame = pending.slice(0, separator);
        pending = pending.slice(separator + 2);
        if (frame.startsWith("data: ")) onEvent(JSON.parse(frame.slice(6)) as SyncEvent);
        separator = pending.indexOf("\n\n");
      }
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
}

export function triggerAdminSync(provider: string): Promise<AdminSyncResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}`, "POST");
}

export function stopAdminSync(provider: string): Promise<{ status: string; provider: string }> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}/stop`, "POST");
}
