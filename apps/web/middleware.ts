import { NextResponse, type NextRequest } from "next/server";
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

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const { pathname } = request.nextUrl;

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
        return NextResponse.rewrite(url);
      }
    } catch {
      // Resolver unreachable — fall through to 404 rather than leak the app.
    }
    return new NextResponse("Not found", { status: 404 });
  }

  // ── Dashboard guard (unchanged) ────────────────────────────────────────
  if (pathname.startsWith("/dashboard")) {
    const hasSession = SESSION_COOKIES.some((name) => request.cookies.has(name));
    if (!hasSession) {
      return NextResponse.redirect(new URL("/sign-in", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // Runs on the dashboard (guard) and on root/app paths (so a custom host can
  // be rewritten); static assets, image optimizer, and favicon are excluded.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
