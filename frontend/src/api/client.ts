import { config } from "../config";
import type {
  AdminAccount,
  AdminSyncResponse,
  AdminSyncStatusResponse,
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
  limit: number = 10
): Promise<VectorSearchResponse> {
  return postJson<VectorSearchResponse>("/v1/search", { query, limit });
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

export async function logoutAdmin(): Promise<void> {
  const res = await fetch(`${config.apiBase}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) await parseError(res);
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

export function getAdminSyncStatus(): Promise<AdminSyncStatusResponse> {
  return adminRequest("/admin/sync/status");
}

export function triggerAdminSync(provider: string): Promise<AdminSyncResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}`, "POST");
}
