import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import { rateLimit, type RateLimiterLike } from "../middleware/rate-limit.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { StatusPageListQuery, StatusPageService } from "../services/status-page.service.js";

export interface StatusPagesRouterDeps {
  statusPages: StatusPageService;
  /** Limiter applied to the public mutating routes (subscribe/verify/unsubscribe). */
  rateLimiter?: RateLimiterLike | null;
}

function slugOf(req: Request): string {
  const slug = req.params.slug;
  if (typeof slug !== "string" || slug.length === 0) throw AppError.notFound("Status page not found.");
  return slug;
}

const subscribeSchema = z.object({ email: z.string().trim().toLowerCase().email().max(320) });
const tokenSchema = z.object({ token: z.string().min(16).max(256) });
const historyQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(90),
});

/**
 * Public, unauthenticated status pages under /status/:slug — the customer-facing
 * read + subscribe surface (Phase 7B). Mounted outside /v1 alongside the other
 * public infrastructure endpoints: no session, no API key, no org scoping.
 * Missing, deleted, and private pages all return 404 so existence never leaks.
 * Mutating routes are rate limited (they trigger email and write rows).
 */
export function statusPagesRouter(deps: StatusPagesRouterDeps): Router {
  const router = Router();
  const limited = rateLimit(deps.rateLimiter ?? null);

  router.get("/status/:slug", async (req, res) => {
    const page = await deps.statusPages.getPublicPage(slugOf(req));
    if (!page) throw AppError.notFound("Status page not found.");
    res.json(page);
  });

  router.get(
    "/status/:slug/incidents",
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<StatusPageListQuery>(req, "query");
      const page = await deps.statusPages.listPublicIncidents(slugOf(req), query);
      if (!page) throw AppError.notFound("Status page not found.");
      res.json(page);
    },
  );

  router.get(
    "/status/:slug/history",
    validate({ query: historyQuerySchema }),
    async (req, res) => {
      const { days } = getValidated<{ days: number }>(req, "query");
      const history = await deps.statusPages.getHistory(slugOf(req), days);
      if (!history) throw AppError.notFound("Status page not found.");
      res.json(history);
    },
  );

  router.post(
    "/status/:slug/subscribe",
    limited,
    validate({ body: subscribeSchema }),
    async (req, res) => {
      const { email } = getValidated<{ email: string }>(req, "body");
      const result = await deps.statusPages.subscribe(slugOf(req), email);
      if (!result) throw AppError.notFound("Status page not found.");
      // 202: a confirmation email is sent unless the address was already active.
      res.status(202).json({
        status: result.status,
        message:
          result.status === "already_active"
            ? "You are already subscribed."
            : "Check your inbox to confirm your subscription.",
      });
    },
  );

  router.post(
    "/status/:slug/verify",
    limited,
    validate({ body: tokenSchema }),
    async (req, res) => {
      const { token } = getValidated<{ token: string }>(req, "body");
      const ok = await deps.statusPages.verifySubscriber(slugOf(req), token);
      if (!ok) throw AppError.notFound("Invalid or expired verification link.");
      res.json({ verified: true });
    },
  );

  router.post(
    "/status/:slug/unsubscribe",
    limited,
    validate({ body: tokenSchema }),
    async (req, res) => {
      const { token } = getValidated<{ token: string }>(req, "body");
      const ok = await deps.statusPages.unsubscribe(slugOf(req), token);
      if (!ok) throw AppError.notFound("Invalid unsubscribe link.");
      res.json({ unsubscribed: true });
    },
  );

  return router;
}
