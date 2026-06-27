/**
 * SSRF (Server-Side Request Forgery) protection for every outbound request the
 * platform makes on behalf of a user (monitor probes, alert webhooks,
 * integration deliveries).
 *
 * Two layers:
 *  1. `validateUrl` — synchronous shape checks (protocol, credentials, literal
 *     IP, hostname denylist) for cheap, early rejection.
 *  2. `createSecureLookup` — a drop-in `lookup` for node http/https/net/tls that
 *     resolves the hostname, validates EVERY resolved address, and connects to
 *     exactly the address it validated. Because validation happens at connect
 *     time on the pinned address, this also defeats DNS-rebinding (TOCTOU).
 *
 * Self-hosted deployments that legitimately monitor internal services can set
 * `SSRF_ALLOW_PRIVATE_NETWORKS=true` to disable the private-range blocks.
 */

import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import type { LookupFunction } from "node:net";

export class SsrfError extends Error {
  readonly code: string;
  constructor(message: string, code = "ssrf_blocked") {
    super(message);
    this.name = "SsrfError";
    this.code = code;
  }
}

export interface SsrfOptions {
  /**
   * When true, private/loopback/link-local addresses are permitted. Defaults to
   * the `SSRF_ALLOW_PRIVATE_NETWORKS` env flag (false unless set to "true").
   */
  allowPrivate?: boolean;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

/** Hostnames that must never be reached even before DNS resolution. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "metadata.azure.com",
]);

export function allowPrivateNetworks(opts?: SsrfOptions): boolean {
  if (opts && opts.allowPrivate !== undefined) return opts.allowPrivate;
  return process.env.SSRF_ALLOW_PRIVATE_NETWORKS === "true";
}

// ─── IPv4 ───────────────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    n = (n << 8) | octet;
  }
  return n >>> 0;
}

function inCidr4(ipInt: number, base: string, bits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Reserved / private / non-routable IPv4 ranges (RFC 1918, 5735, 6598, …). */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this host"
  ["10.0.0.0", 8], // RFC1918 private
  ["100.64.0.0", 10], // RFC6598 CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local (incl. 169.254.169.254 cloud metadata)
  ["172.16.0.0", 12], // RFC1918 private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.168.0.0", 16], // RFC1918 private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + 255.255.255.255 broadcast
];

export function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → fail closed
  return BLOCKED_V4.some(([base, bits]) => inCidr4(n, base, bits));
}

// ─── IPv6 ───────────────────────────────────────────────────────────────────

/** Rewrite an embedded dotted-quad (e.g. ::ffff:127.0.0.1) into hex groups. */
function normalizeEmbeddedV4(input: string): string | null {
  if (!input.includes(".")) return input;
  const idx = input.lastIndexOf(":");
  const v4 = ipv4ToInt(input.slice(idx + 1));
  if (v4 === null) return null;
  const hi = ((v4 >>> 16) & 0xffff).toString(16);
  const lo = (v4 & 0xffff).toString(16);
  return `${input.slice(0, idx + 1)}${hi}:${lo}`;
}

/** Parse an IPv6 address to exactly 8 hextets, or null if malformed. */
export function parseIpv6(input: string): number[] | null {
  const stripped = input.split("%")[0]!; // drop zone id
  const norm = normalizeEmbeddedV4(stripped);
  if (norm === null) return null;

  const halves = norm.split("::");
  if (halves.length > 2) return null;

  const toGroups = (str: string): number[] | null => {
    if (str === "") return [];
    const out: number[] = [];
    for (const g of str.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = toGroups(norm);
    return groups && groups.length === 8 ? groups : null;
  }

  const head = toGroups(halves[0]!);
  const tail = toGroups(halves[1]!);
  if (head === null || tail === null) return null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for ≥1 zero group
  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function groupsToV4(g6: number, g7: number): string {
  return `${(g6 >> 8) & 0xff}.${g6 & 0xff}.${(g7 >> 8) & 0xff}.${g7 & 0xff}`;
}

export function isBlockedIpv6(ip: string): boolean {
  const g = parseIpv6(ip);
  if (g === null) return true; // fail closed
  if (g.every((x) => x === 0)) return true; // :: unspecified
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 loopback
  // IPv4-mapped ::ffff:a.b.c.d
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isBlockedIpv4(groupsToV4(g[6]!, g[7]!));
  }
  // IPv4-compatible ::a.b.c.d (deprecated)
  if (g.slice(0, 6).every((x) => x === 0) && (g[6] !== 0 || g[7] !== 0)) {
    return isBlockedIpv4(groupsToV4(g[6]!, g[7]!));
  }
  const first = g[0]!;
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7 unique-local
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/** True if an IP literal points at a private/reserved/non-routable address. */
export function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedIpv4(ip);
  if (kind === 6) return isBlockedIpv6(ip);
  return true; // not a valid IP → fail closed
}

// ─── URL validation ─────────────────────────────────────────────────────────

function normalizeHost(hostname: string): string {
  // URL keeps IPv6 in brackets; strip them, drop a trailing FQDN dot, lowercase.
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * Synchronous URL safety checks: protocol allow-list, no embedded credentials,
 * hostname denylist, and literal-IP classification. Throws SsrfError on reject.
 */
export function validateUrl(raw: string, opts?: SsrfOptions): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError(`Invalid URL: ${raw}`, "ssrf_invalid_url");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new SsrfError(`Blocked protocol "${url.protocol}"`, "ssrf_protocol");
  }
  if (url.username || url.password) {
    throw new SsrfError("Embedded URL credentials are not allowed", "ssrf_credentials");
  }

  const host = normalizeHost(url.hostname);
  if (!host) throw new SsrfError("URL has no hostname", "ssrf_invalid_url");

  if (!allowPrivateNetworks(opts)) {
    if (BLOCKED_HOSTNAMES.has(host) || host === "localhost" || host.endsWith(".localhost")) {
      throw new SsrfError(`Blocked hostname "${host}"`, "ssrf_blocked_host");
    }
    if (isIP(host) && isBlockedIp(host)) {
      throw new SsrfError(`Blocked IP address "${host}"`, "ssrf_blocked");
    }
  }
  return url;
}

// ─── DNS resolution + classification ────────────────────────────────────────

function lookupAll(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses.map((a) => a.address));
    });
  });
}

/**
 * Full async assertion for paths that cannot use a custom `lookup` (e.g. fetch):
 * validate the URL shape, resolve the hostname, and reject if ANY resolved
 * address is private/reserved.
 */
export async function assertSafeUrl(raw: string, opts?: SsrfOptions): Promise<URL> {
  const url = validateUrl(raw, opts);
  if (allowPrivateNetworks(opts)) return url;

  const host = normalizeHost(url.hostname);
  if (isIP(host)) {
    if (isBlockedIp(host)) throw new SsrfError(`Blocked IP address "${host}"`);
    return url;
  }

  let addresses: string[];
  try {
    addresses = await lookupAll(host);
  } catch (err) {
    throw new SsrfError(
      `Could not resolve "${host}": ${err instanceof Error ? err.message : String(err)}`,
      "ssrf_dns_error",
    );
  }
  if (addresses.length === 0) {
    throw new SsrfError(`No address resolved for "${host}"`, "ssrf_no_address");
  }
  for (const address of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(`"${host}" resolves to blocked address ${address}`);
    }
  }
  return url;
}

// ─── Connect-time lookup (the strong, rebinding-proof layer) ─────────────────

/**
 * A `lookup` function for node http/https/net/tls. It resolves the hostname,
 * rejects the connection if any resolved address is private/reserved, and
 * returns the validated address — so the socket connects to exactly what was
 * checked. This is what makes DNS-rebinding ineffective.
 */
export function createSecureLookup(opts?: SsrfOptions): LookupFunction {
  const allow = allowPrivateNetworks(opts);

  const secureLookup = (
    hostname: string,
    options: unknown,
    callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
  ): void => {
    const cb =
      typeof options === "function"
        ? (options as typeof callback)
        : callback;
    const lookupOptions: Record<string, unknown> =
      typeof options === "object" && options !== null ? { ...(options as object) } : {};

    if (allow) {
      dnsLookup(hostname, lookupOptions, cb as never);
      return;
    }

    dnsLookup(hostname, { ...lookupOptions, all: true }, (err, addresses) => {
      if (err) return cb(err, "");
      if (!addresses.length) {
        return cb(new SsrfError(`No address for "${hostname}"`, "ssrf_no_address"), "");
      }
      for (const a of addresses) {
        if (isBlockedIp(a.address)) {
          return cb(new SsrfError(`Blocked address ${a.address} for "${hostname}"`), "");
        }
      }
      if (lookupOptions.all) return cb(null, addresses);
      const first = addresses[0]!;
      cb(null, first.address, first.family);
    });
  };

  return secureLookup as unknown as LookupFunction;
}
