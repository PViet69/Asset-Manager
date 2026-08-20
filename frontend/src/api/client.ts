import { config } from "../config";
import type { VectorSearchResponse } from "../types";

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
  // FastAPI returns { detail: string | { msg: ... } } on errors.
  // Backend exceptions already produce sanitized safe_message strings.
  let message = `Request failed with status ${res.status}`;
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string" && body.detail.length > 0) {
      message = body.detail;
    } else if (body.detail && typeof body.detail === "object") {
      message = JSON.stringify(body.detail);
    }
  } catch {
    // body wasn't JSON — keep status-based message
  }
  throw new ApiError(res.status, message);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: buildHeaders({ "Content-Type": "application/json" }),
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
