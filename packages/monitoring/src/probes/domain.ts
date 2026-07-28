import { request as httpsRequest } from "node:https";
import { createSecureLookup, validateUrl, SsrfError } from "@backend-uptime/notifications";
import type { DomainInfo, Probe, ProbeContext, ProbeSignal } from "../types.js";

/**
 * IANA's RDAP bootstrap registry: maps a TLD to the RDAP server(s) that hold
 * its registration data. This is the standard, structured replacement for
 * scraping WHOIS text — every gTLD/ccTLD registry that supports RDAP is
 * listed here, so a two-step lookup (bootstrap → registry) covers domains
 * without hardcoding a per-TLD server list.
 */
const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_CACHE_MS = 24 * 60 * 60 * 1000; // the bootstrap file changes rarely
const MAX_REDIRECTS = 5;

interface BootstrapEntry {
  tlds: string[];
  servers: string[];
}

let bootstrapCache: { fetchedAt: number; entries: BootstrapEntry[] } | null = null;

/**
 * One JSON request with the same SSRF guard every other outbound probe uses.
 * Follows 3xx redirects (registries commonly delegate via a 302, e.g.
 * rdap.org → the authoritative registry) up to `MAX_REDIRECTS` hops; each
 * redirect target is re-validated with `validateUrl` before being followed,
 * since a `Location` header is attacker-influenced data just like a DNS
 * answer is, and could otherwise be used to reach internal infrastructure.
 */
function fetchJson(url: URL, timeoutMs: number, ctx: ProbeContext, redirectsLeft = MAX_REDIRECTS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: "GET",
        headers: { accept: "application/rdap+json, application/json", "user-agent": "UptimeFlow/1.0" },
        timeout: timeoutMs,
        lookup: createSecureLookup(),
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // discard the (usually empty) redirect body
          if (redirectsLeft <= 0) {
            reject(new Error(`RDAP request to ${url.hostname} exceeded the redirect limit.`));
            return;
          }
          let next: URL;
          try {
            next = validateUrl(new URL(res.headers.location, url).toString());
          } catch (err) {
            reject(err);
            return;
          }
          resolve(fetchJson(next, timeoutMs, ctx, redirectsLeft - 1));
          return;
        }

        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          if (status === 404) return resolve(null); // not found is a valid, meaningful answer
          if (status >= 400) return reject(new Error(`RDAP request to ${url.hostname} failed with ${status}.`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error(`RDAP response from ${url.hostname} was not valid JSON.`));
          }
        });
      },
    );
    const onAbort = (): void => {
      req.destroy(new Error("aborted"));
    };
    ctx.signal.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", () => {
      const err = new Error("RDAP request timed out.") as NodeJS.ErrnoException;
      err.code = "ETIMEDOUT";
      req.destroy(err);
    });
    req.on("error", (err) => {
      ctx.signal.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.on("close", () => ctx.signal.removeEventListener("abort", onAbort));
    req.end();
  });
}

/**
 * Candidate TLD keys for bootstrap lookup, longest suffix first. IANA's DNS
 * bootstrap file only lists top-level entries (RFC 9224 §3), so a domain like
 * "example.co.uk" won't have a "co.uk" entry — it must be looked up under
 * "uk". Trying progressively shorter suffixes (co.uk, then uk) handles both
 * compound public suffixes and plain TLDs with one matching strategy, without
 * needing a hardcoded public-suffix list.
 */
function tldCandidates(host: string): string[] {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  const candidates: string[] = [];
  // Skip i = 0 (the full hostname, e.g. "example.co.uk" itself is never a
  // TLD entry) and start from the first real suffix, e.g. "co.uk", then
  // "uk". A single-label host (no dots) has no TLD suffix at all.
  for (let i = 1; i < parts.length; i++) {
    candidates.push(parts.slice(i).join("."));
  }
  return candidates;
}

async function loadBootstrap(timeoutMs: number, ctx: ProbeContext): Promise<BootstrapEntry[]> {
  if (bootstrapCache && Date.now() - bootstrapCache.fetchedAt < BOOTSTRAP_CACHE_MS) {
    return bootstrapCache.entries;
  }
  const raw = (await fetchJson(validateUrl(IANA_BOOTSTRAP_URL), timeoutMs, ctx)) as
    | { services?: [string[], string[]][] }
    | null;
  const entries: BootstrapEntry[] = (raw?.services ?? []).map(([tlds, servers]) => ({ tlds, servers }));
  bootstrapCache = { fetchedAt: Date.now(), entries };
  return entries;
}

/**
 * Find the RDAP base URL(s) for a domain, trying the most specific matching
 * suffix first (see `tldCandidates`). Returns every base URL IANA lists for
 * that entry — RFC 9224's Service URL Array is deliberately a list so
 * clients can fall back to a mirror if the first one is unreachable.
 */
function serversFor(entries: BootstrapEntry[], host: string): string[] {
  for (const candidate of tldCandidates(host)) {
    const match = entries.find((e) => e.tlds.some((t) => t.toLowerCase() === candidate));
    if (match) return match.servers;
  }
  return [];
}

interface RdapEvent {
  eventAction?: string;
  eventDate?: string;
}
interface RdapEntity {
  roles?: string[];
  vcardArray?: unknown;
  handle?: string;
}
interface RdapResponse {
  events?: RdapEvent[];
  status?: string[];
  entities?: RdapEntity[];
  ldhName?: string;
}

function extractRegistrar(rdap: RdapResponse): string | null {
  const registrarEntity = rdap.entities?.find((e) => e.roles?.includes("registrar"));
  if (!registrarEntity) return null;
  // vcardArray is ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Name"], ...]]
  const vcard = registrarEntity.vcardArray;
  if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
    const fnField = (vcard[1] as unknown[]).find(
      (field): field is [string, unknown, string, string] => Array.isArray(field) && field[0] === "fn",
    );
    if (fnField) return fnField[3];
  }
  return registrarEntity.handle ?? null;
}

/** Sentinel so callers can tell "this server said no such domain" (final,
 * don't try another mirror) apart from "this server failed" (fall back). */
const NOT_FOUND = Symbol("rdap-not-found");

async function queryServer(
  server: string,
  host: string,
  timeoutMs: number,
  ctx: ProbeContext,
): Promise<RdapResponse | typeof NOT_FOUND> {
  const base = server.replace(/\/+$/, "");
  const target = validateUrl(`${base}/domain/${encodeURIComponent(host)}`);
  const rdap = (await fetchJson(target, timeoutMs, ctx)) as RdapResponse | null;
  return rdap ?? NOT_FOUND;
}

/**
 * DOMAIN probe. Looks up registration data via RDAP (bootstrap → registry) and
 * reports the domain's expiration date. Reachability means "we got a
 * registration record with an expiration event" — the DOWN/DEGRADED
 * classification on days-until-expiry happens in `evaluateValidations`, the
 * same way SSL cert expiry works.
 */
export const domainProbe: Probe = async (monitor, ctx) => {
  const host = monitor.host?.trim().toLowerCase();
  if (!host) {
    return { reachable: false, responseMs: 0, errorType: "config", errorMessage: "Monitor needs a host." };
  }

  const started = performance.now();
  const timeoutMs = monitor.timeoutSeconds * 1000;

  try {
    const entries = await loadBootstrap(timeoutMs, ctx);
    const servers = serversFor(entries, host);
    if (servers.length === 0) {
      return {
        reachable: false,
        responseMs: Math.round(performance.now() - started),
        errorType: "config",
        errorMessage: `No RDAP server is registered for "${host}"'s TLD.`,
      };
    }

    // Try each mirror IANA lists for this TLD in order; a definitive "no such
    // domain" answer is final, but a transport failure (timeout, connection
    // refused, malformed response) falls through to the next mirror instead
    // of reporting the whole domain as unreachable over one server's blip.
    let rdap: RdapResponse | typeof NOT_FOUND | null = null;
    let lastError: unknown;
    for (const server of servers) {
      try {
        rdap = await queryServer(server, host, timeoutMs, ctx);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    const responseMs = Math.round(performance.now() - started);

    if (rdap === null) {
      throw lastError ?? new Error(`All RDAP servers for "${host}" failed.`);
    }
    if (rdap === NOT_FOUND) {
      return {
        reachable: false,
        responseMs,
        errorType: "dns",
        errorMessage: `No registration record found for "${host}".`,
      };
    }

    const expiryEvent = rdap.events?.find((e) => e.eventAction === "expiration");
    if (!expiryEvent?.eventDate) {
      return {
        reachable: false,
        responseMs,
        errorType: "error",
        errorMessage: `RDAP record for "${host}" had no expiration date.`,
      };
    }

    const expiresAt = new Date(expiryEvent.eventDate);
    const domain: DomainInfo = {
      expiresAt,
      daysUntilExpiry: Math.floor((expiresAt.getTime() - ctx.now.getTime()) / 86_400_000),
      registrar: extractRegistrar(rdap),
      statuses: rdap.status ?? [],
    };
    return { reachable: true, responseMs, domain };
  } catch (error) {
    const responseMs = Math.round(performance.now() - started);
    if (error instanceof SsrfError) {
      return { reachable: false, responseMs, errorType: "blocked", errorMessage: error.message };
    }
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ETIMEDOUT" || ctx.signal.aborted) {
      return { reachable: false, responseMs, errorType: "timeout", errorMessage: "RDAP lookup timed out." };
    }
    return {
      reachable: false,
      responseMs,
      errorType: "error",
      errorMessage: err.message ?? `RDAP lookup for "${host}" failed.`,
    };
  }
};

/** Test-only: reset the module-level bootstrap cache between test files. */
export function __resetDomainProbeCache(): void {
  bootstrapCache = null;
}