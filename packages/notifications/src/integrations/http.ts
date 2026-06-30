import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createSecureLookup, validateUrl, SsrfError, type SsrfOptions } from "../security/ssrf.js";

export interface DeliveryResult {
  ok: boolean;
  /** HTTP status, or 0 on a network/timeout error. */
  status: number;
  error?: string;
}

/** Subset of the WHATWG fetch signature, so tests can inject a stub. */
export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
    redirect?: "follow" | "error" | "manual";
  },
) => Promise<{ status: number; ok: boolean; text(): Promise<string> }>;

export interface PostJsonOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  /** SSRF policy override (e.g. allowPrivate for self-hosted/internal). */
  ssrf?: SsrfOptions;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * POST a JSON body and normalize the outcome into a DeliveryResult. Never
 * throws: network errors, timeouts and non-2xx all come back as
 * `{ ok: false, status, error }` so the queue processor can decide on retries.
 */
export function postJson(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<DeliveryResult> {
  return postRaw(url, JSON.stringify(body), options);
}

/**
 * POST a pre-serialized body — used when the exact bytes matter (e.g. an HMAC
 * signature must cover the same string that is sent). Same never-throws
 * contract as postJson.
 *
 * SSRF protection has two layers depending on the path:
 *
 *  - fetchImpl injected (tests): `validateUrl` runs synchronous checks only
 *    (protocol, credentials, hostname denylist, literal IPs). No DNS is
 *    needed since the stub never reaches the network.
 *
 *  - Production (no fetchImpl): uses Node's http/https with `createSecureLookup`
 *    as the `lookup` option. Validation happens at connect time on the pinned
 *    address, so DNS rebinding (TOCTOU) is structurally impossible — the socket
 *    connects to exactly the address that was validated.
 *    Redirects are never followed (Node's http/https does not auto-redirect),
 *    which also closes the redirect-as-SSRF-pivot attack.
 */
export async function postRaw(
  url: string,
  body: string,
  options: PostJsonOptions = {},
): Promise<DeliveryResult> {
  // Sync check first — cheap rejection of bad protocols, embedded credentials,
  // hostname denylist entries, and literal private IPs.
  let parsed: URL;
  try {
    parsed = validateUrl(url, options.ssrf);
  } catch (err) {
    if (err instanceof SsrfError) return { ok: false, status: 0, error: err.message };
    throw err;
  }

  // ── Test path ──────────────────────────────────────────────────────────────
  // When a fetchImpl is injected the caller controls the network; we've already
  // done the sync URL validation above so just forward directly.
  if (options.fetchImpl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const res = await options.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...options.headers },
        body,
        signal: controller.signal,
        redirect: "error",
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

  // ── Production path ────────────────────────────────────────────────────────
  // Use Node's http/https with createSecureLookup so validation happens at
  // connect time on the pinned address.  This closes the DNS-rebinding TOCTOU
  // window that exists when assertSafeUrl + a second fetch() resolution are
  // used sequentially.
  const secureLookup = createSecureLookup(options.ssrf);
  const requestFn = parsed.protocol === "https:" ? httpsRequest : httpRequest;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const outHeaders: Record<string, string | number> = {
    "content-type": "application/json",
    ...options.headers,
    "content-length": Buffer.byteLength(body),
  };

  return new Promise((resolve) => {
    const req = requestFn(
      url,
      {
        method: "POST",
        headers: outHeaders,
        lookup: secureLookup,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          const ok = status >= 200 && status < 300;
          if (ok) {
            resolve({ ok: true, status });
          } else {
            resolve({ ok: false, status, error: text.slice(0, 500) || `HTTP ${status}` });
          }
        });
      },
    );

    req.on("timeout", () => {
      // destroy() triggers the "error" handler below with the given error.
      req.destroy(new Error("Request timed out"));
    });

    req.on("error", (err) => {
      resolve({ ok: false, status: 0, error: err.message });
    });

    req.write(body);
    req.end();
  });
}
