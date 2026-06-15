/** A single outbound message handed to an EmailProvider. */
export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Template name — used only for logging/metrics labels. */
  template?: string;
}

export interface EmailSendResult {
  messageId: string | null;
  provider: string;
}

export interface BulkEmailResult {
  sent: number;
  failed: number;
  results: Array<{ to: string; messageId: string | null; error?: string }>;
}

export interface EmailHealth {
  provider: string;
  status: "healthy" | "unhealthy";
  region?: string;
  detail?: string;
}

/**
 * Transport-agnostic email provider. Implementations (SES, logging, …) own the
 * delivery mechanics; the notification pipeline only depends on this interface.
 */
export interface EmailProvider {
  readonly name: string;
  sendEmail(message: EmailMessage): Promise<EmailSendResult>;
  sendBulkEmail(messages: EmailMessage[]): Promise<BulkEmailResult>;
  healthCheck(): Promise<EmailHealth>;
}

export interface ProviderLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

// ──────────────────────────── Error classification ──────────────────────────

export type EmailErrorKind =
  | "rate_limit"
  | "invalid_recipient"
  | "auth"
  | "network"
  | "server"
  | "config"
  | "unknown";

export interface ClassifiedEmailError {
  kind: EmailErrorKind;
  retryable: boolean;
  name: string;
  message: string;
  statusCode?: number;
}

interface AwsLikeError {
  name?: string;
  message?: string;
  code?: string;
  $metadata?: { httpStatusCode?: number };
}

/**
 * Classify an SES (or transport) error into a stable kind + retryability, so the
 * retry loop and metrics can react consistently. Throttling and 5xx/network
 * errors are retryable; rejected/invalid recipients and auth errors are not.
 */
export function classifyEmailError(error: unknown): ClassifiedEmailError {
  const err = (error ?? {}) as AwsLikeError;
  const name = err.name ?? "Error";
  const message = err.message ?? String(error);
  const code = err.code ?? "";
  const statusCode = err.$metadata?.httpStatusCode;

  const is = (...names: string[]): boolean => names.includes(name) || names.includes(code);

  if (is("ThrottlingException", "TooManyRequestsException", "Throttling", "LimitExceededException")) {
    return { kind: "rate_limit", retryable: true, name, message, statusCode };
  }
  if (is("MessageRejected", "MailFromDomainNotVerifiedException", "AccountSuspendedException", "SendingPausedException")) {
    return { kind: "invalid_recipient", retryable: false, name, message, statusCode };
  }
  if (is("AccessDeniedException", "UnrecognizedClientException", "InvalidClientTokenId", "AuthFailure")) {
    return { kind: "auth", retryable: false, name, message, statusCode };
  }
  if (is("BadRequestException", "ValidationException")) {
    return { kind: "config", retryable: false, name, message, statusCode };
  }
  if (
    is("TimeoutError", "RequestTimeout", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE") ||
    name === "NetworkingError"
  ) {
    return { kind: "network", retryable: true, name, message, statusCode };
  }
  if (typeof statusCode === "number" && statusCode >= 500) {
    return { kind: "server", retryable: true, name, message, statusCode };
  }
  if (typeof statusCode === "number" && statusCode === 429) {
    return { kind: "rate_limit", retryable: true, name, message, statusCode };
  }
  return { kind: "unknown", retryable: false, name, message, statusCode };
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: ClassifiedEmailError, delayMs: number) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with exponential backoff + full jitter, retrying only retryable
 * errors up to `maxAttempts`. The final error is rethrown.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const base = options.baseDelayMs ?? 200;
  const max = options.maxDelayMs ?? 5_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const classified = classifyEmailError(error);
      if (!classified.retryable || attempt >= options.maxAttempts) break;
      // Exponential backoff with full jitter.
      const ceiling = Math.min(max, base * 2 ** (attempt - 1));
      const delayMs = Math.round(ceiling * (0.5 + Math.random() / 2));
      options.onRetry?.(attempt, classified, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
