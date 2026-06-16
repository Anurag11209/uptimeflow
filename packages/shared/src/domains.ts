/**
 * Custom-domain helpers (Phase 11). Pure + dependency-free so both the API
 * (validation, DNS-challenge naming) and the web UI (client-side validation,
 * rendering the DNS instructions) share one implementation.
 */

/** DNS label: 1–63 chars, alphanumeric + hyphen, no leading/trailing hyphen. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Normalize a user-entered hostname: lowercase, trim, strip an accidental
 * scheme/path/port, and drop a trailing dot. Returns null if the result is not
 * a valid public domain (needs ≥2 labels, a non-numeric TLD, ≤253 chars, no
 * wildcard, not an IP/localhost).
 */
export function normalizeDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  let host = input.trim().toLowerCase();
  if (host.length === 0) return null;

  // Strip scheme + any path if the user pasted a URL.
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split("/")[0] ?? host;
  // Strip a :port if present.
  host = host.split(":")[0] ?? host;
  // Drop a single trailing dot (FQDN form).
  if (host.endsWith(".")) host = host.slice(0, -1);

  if (host.length === 0 || host.length > 253) return null;
  if (host.includes("*")) return null; // no wildcards
  if (host === "localhost") return null;
  // Reject bare IPv4 / IPv6.
  if (/^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return null;

  const labels = host.split(".");
  if (labels.length < 2) return null;
  if (!labels.every((l) => LABEL.test(l))) return null;

  // TLD must be alphabetic (≥2 chars) — rejects "acme.123".
  const tld = labels[labels.length - 1]!;
  if (!/^[a-z]{2,}$/.test(tld)) return null;

  return host;
}

export function isValidDomain(input: string): boolean {
  return normalizeDomain(input) !== null;
}

/** Default DNS prefix for the TXT ownership challenge record. */
export const DEFAULT_CHALLENGE_PREFIX = "_uptimeflow-challenge";

export interface DnsInstructions {
  /** TXT record proving control of the domain. */
  txtRecord: { type: "TXT"; name: string; value: string };
  /** CNAME pointing the hostname at our edge (for routing once verified). */
  cnameRecord: { type: "CNAME"; name: string; value: string };
}

/**
 * The DNS records a customer must add. `name` values are fully-qualified (no
 * trailing dot) so they can be shown verbatim or pasted into most DNS UIs.
 */
export function buildDnsInstructions(args: {
  domain: string;
  token: string;
  cnameTarget: string;
  challengePrefix?: string;
}): DnsInstructions {
  const prefix = args.challengePrefix ?? DEFAULT_CHALLENGE_PREFIX;
  return {
    txtRecord: { type: "TXT", name: `${prefix}.${args.domain}`, value: args.token },
    cnameRecord: { type: "CNAME", name: args.domain, value: args.cnameTarget },
  };
}

/** Hostname where the ownership TXT challenge is expected to resolve. */
export function challengeHostname(domain: string, challengePrefix = DEFAULT_CHALLENGE_PREFIX): string {
  return `${challengePrefix}.${domain}`;
}
