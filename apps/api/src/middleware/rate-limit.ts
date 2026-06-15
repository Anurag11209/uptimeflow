import type { RequestHandler } from "express";
import { RateLimiterMemory, RateLimiterRedis, RateLimiterRes } from "rate-limiter-flexible";
import type { Redis } from "ioredis";
import { AppError } from "@backend-uptime/shared";
import type { Env } from "../env.js";

/** Minimal surface the middleware needs — easy to stub in tests. */
export interface RateLimiterLike {
  points: number;
  consume(key: string): Promise<RateLimiterRes>;
}

/**
 * Redis-backed fixed-window limiter for /v1 routes, keyed by client IP.
 * Better Auth ships its own limiter for /api/auth/*; this one covers the
 * REST surface. The in-memory insurance limiter keeps the API degrading
 * gracefully (rather than failing open or closed) during Redis blips.
 */
export function createApiRateLimiter(
  redis: Redis,
  env: Pick<Env, "RATE_LIMIT_POINTS" | "RATE_LIMIT_WINDOW_SECONDS">,
): RateLimiterLike {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl:v1",
    points: env.RATE_LIMIT_POINTS,
    duration: env.RATE_LIMIT_WINDOW_SECONDS,
    insuranceLimiter: new RateLimiterMemory({
      points: env.RATE_LIMIT_POINTS,
      duration: env.RATE_LIMIT_WINDOW_SECONDS,
    }),
  });
}

export function rateLimit(limiter: RateLimiterLike | null): RequestHandler {
  return async (req, res, next) => {
    if (!limiter) return next();
    const key = req.ip ?? "unknown";
    try {
      const result = await limiter.consume(key);
      res.setHeader("X-RateLimit-Limit", String(limiter.points));
      res.setHeader("X-RateLimit-Remaining", String(Math.max(0, result.remainingPoints)));
      next();
    } catch (rejection) {
      if (rejection instanceof RateLimiterRes) {
        const retryAfterSeconds = Math.max(1, Math.ceil(rejection.msBeforeNext / 1000));
        res.setHeader("Retry-After", String(retryAfterSeconds));
        res.setHeader("X-RateLimit-Limit", String(limiter.points));
        res.setHeader("X-RateLimit-Remaining", "0");
        next(new AppError("rate_limited", "Too many requests. Slow down and retry shortly."));
        return;
      }
      next(rejection as Error);
    }
  };
}
