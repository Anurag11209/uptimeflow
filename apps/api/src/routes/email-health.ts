import { Router } from "express";
import type { EmailProvider } from "@backend-uptime/notifications";

export interface EmailHealthDeps {
  emailProvider: EmailProvider;
}

/**
 * GET /internal/email/health — checks the email provider (SES) is reachable and
 * sending-enabled. Unauthenticated internal endpoint (like /healthz); returns
 * 200 when healthy, 503 otherwise.
 */
export function emailHealthRouter(deps: EmailHealthDeps): Router {
  const router = Router();

  router.get("/internal/email/health", async (_req, res) => {
    const health = await deps.emailProvider.healthCheck();
    res.status(health.status === "healthy" ? 200 : 503).json({
      provider: health.provider,
      status: health.status,
      region: health.region ?? null,
      ...(health.detail ? { detail: health.detail } : {}),
    });
  });

  return router;
}
