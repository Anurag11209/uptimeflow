import { NextResponse, type NextRequest } from "next/server";

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

export function middleware(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) =>
    request.cookies.has(name),
  );

  if (!hasSession) {
    const signInUrl = new URL("/sign-in", request.url);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
