export interface DeliveryResult {
  ok: boolean;
  /** HTTP status, or 0 on a network/timeout error. */
  status: number;
  error?: string;
}

/** Subset of the WHATWG fetch signature, so tests can inject a stub. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * POST a JSON body and normalize the outcome into a DeliveryResult. Never
 * throws: network errors, timeouts and non-2xx all come back as
 * `{ ok: false, status, error }` so the queue processor can decide on retries.
 */
export function postJson(url: string, body: unknown, options: PostJsonOptions = {}): Promise<DeliveryResult> {
  return postRaw(url, JSON.stringify(body), options);
}

/**
 * POST a pre-serialized body — used when the exact bytes matter (e.g. an HMAC
 * signature must cover the same string that is sent). Same never-throws
 * contract as postJson.
 */
export async function postRaw(url: string, body: string, options: PostJsonOptions = {}): Promise<DeliveryResult> {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body,
      signal: controller.signal,
    });
    if (res.ok) return { ok: true, status: res.status };
    const text = await res.text().catch(() => "");
    return { ok: false, status: res.status, error: text.slice(0, 500) || `HTTP ${res.status}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}
