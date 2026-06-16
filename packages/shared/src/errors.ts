/** Stable, machine-readable error codes returned by the API. */
export const ERROR_CODES = [
  "bad_request",
  "validation_failed",
  "unauthorized",
  "forbidden",
  "payment_required",
  "not_found",
  "conflict",
  "rate_limited",
  "internal_error",
  "service_unavailable",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const DEFAULT_STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 400,
  unauthorized: 401,
  forbidden: 403,
  // Over a plan limit / capability not on the current plan — the caller must
  // upgrade or free up capacity, so it is distinct from 403 (RBAC denial).
  payment_required: 402,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: { status?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? DEFAULT_STATUS[code];
    this.details = options.details;
    // 5xx messages are replaced with a generic message at the edge.
    this.expose = this.status < 500;
  }

  static unauthorized(message = "Authentication required."): AppError {
    return new AppError("unauthorized", message);
  }
  static forbidden(message = "You do not have permission to perform this action."): AppError {
    return new AppError("forbidden", message);
  }
  static notFound(message = "Resource not found."): AppError {
    return new AppError("not_found", message);
  }
  static conflict(message: string, details?: unknown): AppError {
    return new AppError("conflict", message, { details });
  }
  /** Plan limit reached or capability not included — surface upgrade details. */
  static paymentRequired(message: string, details?: unknown): AppError {
    return new AppError("payment_required", message, { details });
  }
}

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId?: string;
    details?: unknown;
  };
}
