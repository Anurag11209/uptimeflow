/**
 * Minimal typed fetch wrapper for the custom /v1 REST surface.
 *
 * Sessions are cookie-based (Better Auth), so we always send credentials.
 * Errors arriving in the ApiErrorBody envelope are surfaced as ApiError so
 * UI code can branch on `code` without string-matching messages.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: ApiErrorBody["error"]) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (body && typeof body === "object" && "error" in body) {
      return new ApiError(res.status, body.error);
    }
  } catch {
    // fall through to generic error
  }
  return new ApiError(res.status, {
    code: "internal_error",
    message: `Request failed with status ${res.status}`,
  });
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (!res.ok) {
    throw await parseError(res);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}
