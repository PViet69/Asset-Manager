import { config } from "../config";
import type {
  AdminAccount,
  AdminDashboardStatusResponse,
  AdminTagDiscoveryResponse,
  AdminDeletePointResponse,
  AdminProviderRefreshResponse,
  AdminQdrantItemsResponse,
  AdminReindexResponse,
  AdminSyncJobStatusResponse,
  AdminSyncQueuedResponse,
  ApprovedTagGroupsResponse,
  ProviderMeta,
  StorageProvider,
  VectorSearchResponse,
} from "../types";



export function getAdminProviderItems(
  provider: string
): Promise<AdminQdrantItemsResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}/items`);
}




export class ApiError extends Error {
  public readonly status: number;
  public readonly jobId?: string;

  constructor(status: number, message: string, jobId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.jobId = jobId;
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
  let jobId: string | null = null;
  try {
    const body = (await res.json()) as {
      detail?: unknown;
      job_id?: unknown;
    };
    if (typeof body.detail === "string" && body.detail.length > 0) {
      message = body.detail;
    } else if (body.detail && typeof body.detail === "object") {
      const detail = body.detail as { detail?: unknown; job_id?: unknown };
      if (typeof detail.detail === "string" && detail.detail.length > 0) {
        message = detail.detail;
      }
      if (typeof detail.job_id === "string") jobId = detail.job_id;
    }
    if (typeof body.job_id === "string") jobId = body.job_id;
  } catch {
    // Keep status-based message when response body is not JSON.
  }
  throw new ApiError(res.status, message, jobId ?? undefined);
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
  provider?: StorageProvider,
  mode: "semantic" | "filename" = "semantic",
  tags?: readonly string[]
): Promise<VectorSearchResponse> {

  const body = {
    query,
    limit,
    mode,
    ...(provider !== undefined && { provider }),
    ...(tags !== undefined && { tags }),
  };
  return postJson<VectorSearchResponse>("/v1/search", body);
}

export async function getApprovedTags(): Promise<ApprovedTagGroupsResponse> {
  const res = await fetch(`${config.apiBase}/v1/search/tags`, {
    headers: buildHeaders(),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as ApprovedTagGroupsResponse;
}

export async function getProviders(): Promise<ProviderMeta[]> {
  const res = await fetch(`${config.apiBase}/v1/providers`, { headers: buildHeaders() });
  if (!res.ok) await parseError(res);
  const data = (await res.json()) as Array<{ id: string; display_name: string }>;
  return data.map((item) => ({
    id: item.id,
    displayName: item.display_name,
  }));
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

export async function logoutAdmin(): Promise<void> {
  await fetch(`${config.apiBase}/auth/logout`, {
    method: "POST",
    headers: buildHeaders(),
    credentials: "include",
  });
}

async function adminRequest<T>(
  path: string,
  method: "GET" | "POST" | "PUT" = "GET",
  body?: unknown
): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    method,
    credentials: "include",
    headers: body === undefined ? undefined : buildHeaders({ "Content-Type": "application/json" }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) await parseError(res);
  return (await res.json()) as T;
}

export function discoverAdminTags(): Promise<AdminTagDiscoveryResponse> {
  return adminRequest("/admin/tags/discover", "POST");
}

export function getAdminTags(): Promise<ApprovedTagGroupsResponse> {
  return adminRequest("/admin/tags");
}

export function saveAdminTags(
  discoveredTags: readonly string[],
  approvedTags: readonly string[]
): Promise<ApprovedTagGroupsResponse> {
  return adminRequest("/admin/tags", "PUT", {
    discovered_tags: discoveredTags,
    approved_tags: approvedTags,
  });
}

export function getAdminSyncStatus(): Promise<AdminDashboardStatusResponse> {
  return adminRequest("/admin/sync/status");
}

export function refreshAdminProvider(
  provider: string
): Promise<AdminProviderRefreshResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}/refresh`, "POST");
}

export function reindexAdminStorageFile(
  provider: string,
  storageFileId: string
): Promise<AdminReindexResponse> {
  return adminRequest(
    `/admin/sync/${encodeURIComponent(provider)}/reindex/${encodeURIComponent(storageFileId)}`,
    "POST"
  );
}

export function triggerAdminSync(provider: string): Promise<AdminSyncQueuedResponse> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}`, "POST");
}

export function getAdminSyncJob(jobId: string): Promise<AdminSyncJobStatusResponse> {
  return adminRequest(`/admin/sync-jobs/${encodeURIComponent(jobId)}`);
}

export function stopAdminSync(provider: string): Promise<{ status: string; provider: string }> {
  return adminRequest(`/admin/sync/${encodeURIComponent(provider)}/stop`, "POST");
}

export function deleteAdminQdrantPoint(
  pointId: string
): Promise<AdminDeletePointResponse> {
  return adminRequest(
    `/admin/sync/qdrant/delete/${encodeURIComponent(pointId)}`,
    "POST"
  );
}

