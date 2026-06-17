/**
 * Custom-domain host routing helpers (Phase 12F). Pure + dependency-free so the
 * decision logic is unit-tested without the edge runtime. The middleware uses
 * these to decide whether an inbound Host is a customer's custom domain (which
 * should render their status page) vs one of the app's own hostnames.
 */

/** Hostnames the app itself serves on — everything else is a custom domain.
 *  Configured via NEXT_PUBLIC_APP_HOSTNAMES (comma-separated); localhost always
 *  counts so local dev is never treated as a custom domain. */
export function parseAppHosts(raw: string | undefined): string[] {
  const configured = (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set(["localhost", "127.0.0.1", ...configured])];
}

/** Strip the port and lowercase a Host header value. */
export function hostname(host: string): string {
  return (host.split(":")[0] ?? "").toLowerCase();
}

export function isAppHost(host: string, appHosts: string[]): boolean {
  return appHosts.includes(hostname(host));
}

/**
 * True when this request should be served as a custom-domain status page:
 * a non-app host, on a path that isn't already a status page, an asset, or the
 * API. The middleware then resolves host→slug and rewrites to /status/<slug>.
 */
export function isCustomHostCandidate(host: string, pathname: string, appHosts: string[]): boolean {
  if (!host || isAppHost(host, appHosts)) return false;
  if (pathname.startsWith("/status")) return false; // already a status page
  if (pathname.startsWith("/_next") || pathname.startsWith("/api")) return false;
  if (pathname.includes(".")) return false; // static asset (favicon, etc.)
  return true;
}
