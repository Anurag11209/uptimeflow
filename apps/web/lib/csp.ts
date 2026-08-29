/**
 * Content-Security-Policy for the app.
 *
 * The policy is the second half of the status-page XSS fix (lib/status.ts
 * `safeJsonLd` is the first): script-src carries a per-request nonce and
 * deliberately omits 'unsafe-inline', so an injected inline <script> does not
 * execute even if some other sink is missed later.
 *
 * script-src is `'self' 'nonce-…'` and deliberately NOT 'strict-dynamic'.
 * Most routes are statically prerendered, so their HTML is built before a
 * request nonce exists and Next cannot stamp one onto the framework's own
 * <script src> tags. 'strict-dynamic' makes CSP3 browsers ignore 'self', which
 * would block every /_next/static chunk and white-screen the app — verified
 * against a production build, where 0 of the served script tags carried a
 * nonce. 'self' keeps those first-party chunks loading.
 *
 * The security property that matters is unaffected: under CSP, `'self'` never
 * authorizes INLINE script. An injected `<script>alert(1)</script>` carries no
 * nonce and is refused, as are inline event handlers like `onerror=`. The
 * nonce still applies to dynamically rendered routes, where Next does stamp it.
 *
 * style-src keeps 'unsafe-inline': React writes `style={{…}}` as inline style
 * attributes (the status page's brand accent is one), and Next injects style
 * tags. Style injection is not script execution, and the accent value is
 * already hex-validated by `safeAccent`.
 */
export interface CspOptions {
  /** Origin of the API the browser calls (NEXT_PUBLIC_API_URL). */
  apiOrigin?: string | null;
  /** Adds upgrade-insecure-requests; off in dev so http://localhost still loads. */
  isProduction?: boolean;
}

/** Extract just the origin, so a full URL in env can't widen the policy. */
export function originOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function buildCsp(nonce: string, options: CspOptions = {}): string {
  const apiOrigin = originOf(options.apiOrigin);

  const directives: string[] = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    // Tenant branding (logoUrl/faviconUrl) is an arbitrary remote image.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    // next/font self-hosts Google Fonts at build time, so no external font host.
    apiOrigin ? `connect-src 'self' ${apiOrigin}` : "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // No part of the product embeds itself; flip to a list if status pages
    // ever need to be iframed by customers.
    "frame-ancestors 'none'",
  ];

  if (options.isProduction) directives.push("upgrade-insecure-requests");

  return directives.join("; ");
}
