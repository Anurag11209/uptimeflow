import cors from "cors";
import helmet from "helmet";
import type { RequestHandler } from "express";
import type { Env } from "../env.js";

export function securityHeaders(): RequestHandler {
  // JSON API: defaults are fine; CSP is irrelevant for non-HTML responses but
  // harmless to keep for the OpenAPI reference page.
  return helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
}

/**
 * CORS must be registered before the Better Auth handler so browser
 * preflights against /api/auth/* succeed. Credentialed requests are limited
 * to the configured origins — never "*".
 */
export function corsPolicy(env: Pick<Env, "corsOrigins">): RequestHandler {
  return cors({
    origin: env.corsOrigins,
    credentials: true,
    maxAge: 600,
    exposedHeaders: ["X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining", "Retry-After"],
  });
}
