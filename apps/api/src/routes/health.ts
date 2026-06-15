import { Router } from "express";
import type { PrismaClient } from "@backend-uptime/db";

export interface HealthDeps {
  prisma: Pick<PrismaClient, "$queryRaw">;
  redis: { ping(): Promise<string> };
}

/**
 * /healthz — liveness: the process is up and the event loop responsive.
 * /readyz  — readiness: dependencies reachable; load balancers should only
 *            route traffic when this returns 200.
 */
export function healthRouter(deps: HealthDeps): Router {
  const router = Router();

  router.get("/healthz", (_req, res) => {
    res.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) });
  });

  router.get("/readyz", async (_req, res) => {
    const checks: Record<string, "ok" | "failed"> = { postgres: "ok", redis: "ok" };

    const results = await Promise.allSettled([
      deps.prisma.$queryRaw`SELECT 1`,
      deps.redis.ping(),
    ]);
    if (results[0].status === "rejected") checks.postgres = "failed";
    if (results[1].status === "rejected") checks.redis = "failed";

    const ready = Object.values(checks).every((status) => status === "ok");
    res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "degraded", checks });
  });

  return router;
}
