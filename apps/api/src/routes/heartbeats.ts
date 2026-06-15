import { Router, type RequestHandler } from "express";
import { AppError } from "@backend-uptime/shared";
import { recordHeartbeat } from "@backend-uptime/monitoring";
import type { PrismaClient } from "@backend-uptime/db";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface HeartbeatsRouterDeps {
  prisma: PrismaClient;
}

/**
 * Public heartbeat ingest: a monitored job pings
 * GET/POST /v1/heartbeats/:monitorId on its own schedule. Unauthenticated by
 * design — the unguessable monitor UUID is the shared secret (a production
 * setup would add a per-monitor token). The monitor's org is resolved
 * internally, so tenant isolation holds. Unknown ids return 404.
 */
export function heartbeatsRouter(deps: HeartbeatsRouterDeps): Router {
  const router = Router();

  const ingest: RequestHandler = async (req, _res, next) => {
    const monitorId = req.params.monitorId;
    if (typeof monitorId !== "string" || !UUID_RE.test(monitorId)) {
      next(AppError.notFound("Heartbeat monitor not found."));
      return;
    }
    try {
      const result = await recordHeartbeat(deps.prisma, monitorId);
      if (!result) {
        next(AppError.notFound("Heartbeat monitor not found."));
        return;
      }
      _res.status(202).json({ received: true, health: result.newHealth });
    } catch (error) {
      next(error);
    }
  };

  router.post("/:monitorId", ingest);
  router.get("/:monitorId", ingest);

  return router;
}
