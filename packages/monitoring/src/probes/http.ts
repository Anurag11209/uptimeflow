import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { TLSSocket } from "node:tls";
import { createSecureLookup, validateUrl, SsrfError } from "@backend-uptime/notifications";
import type { CertInfo, MonitorSnapshot, Probe, ProbeContext, ProbeSignal } from "../types.js";

const MAX_BODY_BYTES = 1_000_000;
const MAX_REDIRECTS = 5;

/** Map a Node socket/DNS error to a coarse failure bucket. */
export function classifyHttpError(err: NodeJS.ErrnoException): string {
  const code = err.code ?? "";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "dns";
  if (code === "ECONNREFUSED") return "refused";
  if (code === "ETIMEDOUT") return "timeout";
  if (
    code.startsWith("CERT_") ||
    code.startsWith("ERR_TLS") ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE" ||
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN"
  )
    return "tls";
  if (code === "ECONNRESET" || code === "EPIPE") return "connect";
  return "error";
}

/** Cert DN fields can be string or string[]; normalize to a single string. */
export function certName(field: string | string[] | undefined): string | null {
  if (Array.isArray(field)) return field[0] ?? null;
  return field ?? null;
}

function extractCert(socket: unknown, now: Date): CertInfo | undefined {
  if (!socket || typeof (socket as TLSSocket).getPeerCertificate !== "function") return undefined;
  const peer = (socket as TLSSocket).getPeerCertificate();
  if (!peer || !peer.valid_to) return undefined;
  const validTo = new Date(peer.valid_to);
  const validFrom = new Date(peer.valid_from);
  return {
    validTo,
    validFrom,
    daysUntilExpiry: Math.floor((validTo.getTime() - now.getTime()) / 86_400_000),
    issuer: certName(peer.issuer?.O) ?? certName(peer.issuer?.CN),
    subject: certName(peer.subject?.CN),
  };
}

interface SingleResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  location?: string;
  cert?: CertInfo;
}

/** One HTTP(S) request, no redirect handling. Rejects on transport failure. */
function performRequest(
  target: URL,
  monitor: MonitorSnapshot,
  ctx: ProbeContext,
): Promise<SingleResponse> {
  const isHttps = target.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const options: RequestOptions = {
    method: monitor.httpMethod ?? "GET",
    headers: { "user-agent": "UptimeFlow/1.0", ...(monitor.requestHeaders ?? {}) },
    timeout: monitor.timeoutSeconds * 1000,
    // Honour the monitor's TLS verification preference.
    rejectUnauthorized: isHttps ? monitor.verifySsl : undefined,
    servername: isHttps ? target.hostname : undefined,
    // SSRF guard: validate + pin the resolved IP at connect time (defeats
    // DNS-rebinding because we connect to exactly the address we validated).
    lookup: createSecureLookup(),
  };

  return new Promise<SingleResponse>((resolve, reject) => {
    const req = requestFn(target, options, (res) => {
      const cert = extractCert(res.socket, ctx.now);
      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;

      res.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (truncated) return;
        if (total > MAX_BODY_BYTES) {
          truncated = true;
          chunks.push(chunk.subarray(0, Math.max(0, chunk.length - (total - MAX_BODY_BYTES))));
          res.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => finish());
      res.on("close", () => finish());

      let settled = false;
      function finish(): void {
        if (settled) return;
        settled = true;
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (v != null) headers[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        }
        resolve({
          statusCode: res.statusCode ?? 0,
          headers,
          body: Buffer.concat(chunks).toString("utf8"),
          location: res.headers.location,
          cert,
        });
      }
    });

    const onAbort = (): void => {
      req.destroy(new Error("aborted"));
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    req.on("timeout", () => {
      const err = new Error("request timed out") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      req.destroy(err);
    });
    req.on("error", (err) => {
      ctx.signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.on("close", () => ctx.signal.removeEventListener("abort", onAbort));

    if (monitor.requestBody) req.write(monitor.requestBody);
    req.end();
  });
}

/**
 * HTTP / HTTPS / API / KEYWORD probe. Captures status, headers, body, latency,
 * and (for HTTPS) the TLS certificate. Follows redirects up to a fixed cap when
 * the monitor opts in. Status/keyword/cert are validated downstream in
 * `evaluateValidations`, not here.
 */
export const httpProbe: Probe = async (monitor, ctx) => {
  if (!monitor.url) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor has no url." };
  }

  const started = performance.now();
  try {
    // Validate the initial URL shape (protocol/credentials/literal IP) up front.
    let current = validateUrl(monitor.url);
    let last: SingleResponse | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      last = await performRequest(current, monitor, ctx);
      const isRedirect = last.statusCode >= 300 && last.statusCode < 400 && !!last.location;
      if (!isRedirect || !monitor.followRedirects || hop === MAX_REDIRECTS) break;
      // Re-validate every redirect hop — a redirect is a classic SSRF pivot.
      current = validateUrl(new URL(last.location!, current).href);
    }

    const responseMs = Math.round(performance.now() - started);
    return {
      reachable: true,
      responseMs,
      statusCode: last!.statusCode,
      headers: last!.headers,
      body: last!.body,
      cert: last!.cert,
    };
  } catch (error) {
    if (error instanceof SsrfError) {
      return {
        reachable: false,
        responseMs: Math.round(performance.now() - started),
        errorType: "blocked",
        errorMessage: error.message,
      };
    }
    const err = error as NodeJS.ErrnoException;
    const errorType = ctx.signal.aborted ? "timeout" : classifyHttpError(err);
    return {
      reachable: false,
      responseMs: Math.round(performance.now() - started),
      errorType,
      errorMessage: err.message,
    };
  }
};
