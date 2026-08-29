import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";
import { isCustomHostCandidate, parseAppHosts } from "@/lib/custom-host";

/**
 * Edge gate for the dashboard. This is a cheap cookie-presence check, not a
 * trust boundary — the API validates every session server-side and the
 * dashboard layout re-checks via useSession. We only redirect obvious
 * signed-out traffic away from /dashboard before any JS loads.
 */
const SESSION_COOKIES = [
  "better-auth.session_token",
  "__Secure-better-auth.session_token",
];

const APP_HOSTS = parseAppHosts(process.env.NEXT_PUBLIC_APP_HOSTNAMES);
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/** Fresh 128-bit nonce per request; Web Crypto, so it works on the Edge runtime. */
function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;

  // ── CSP ────────────────────────────────────────────────────────────────
  // Every response leaves here with a nonce-based policy. The nonce also goes
  // out on the REQUEST headers: Next reads the CSP there and stamps the same
  // nonce onto the framework's own inline scripts, which is what lets
  // script-src drop 'unsafe-inline' without breaking hydration.
  const nonce = makeNonce();
  const csp = buildCsp(nonce, {
    apiOrigin: API_BASE,
    isProduction: process.env.NODE_ENV === "production",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const withCsp = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  // ── Custom-domain serving ──────────────────────────────────────────────
  // A verified customer domain (status.acme.com) renders its status page. We
  // resolve host → slug via the public API and rewrite to /status/<slug> so
  // the canonical slug route does the actual rendering. Unverified/unknown
  // hosts get a 404. The app's own hostnames skip this entirely.
  if (isCustomHostCandidate(host, pathname, APP_HOSTS)) {
    const h = host.split(":")[0] ?? "";
    try {
      const res = await fetch(`${API_BASE}/v1/public/status-pages/resolve?host=${encodeURIComponent(h)}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        const { slug } = (await res.json()) as { slug: string };
        const url = request.nextUrl.clone();
        url.pathname = `/status/${slug}`;
        return withCsp(NextResponse.rewrite(url, { request: { headers: requestHeaders } }));
      }
    } catch {
      // Resolver unreachable — fall through to 404 rather than leak the app.
    }
    return withCsp(new NextResponse("Not found", { status: 404 }));
  }

  // ── Dashboard guard (unchanged) ────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
    if (!hasSession) {
      return withCsp(NextResponse.redirect(new URL("/sign-in", request.url)));
    }
  }

  return withCsp(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Runs on the dashboard (guard) and on root/app paths (so a custom host can
  // be rewritten); static assets, image optimizer, and favicon are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
