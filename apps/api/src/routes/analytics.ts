import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import { rangeForDays, type AnalyticsService } from "../services/analytics.service.js";

// Reporting windows top out at a year — beyond that the daily rollup loses its
// value and the query cost is better served by an export pipeline.
const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(366).default(30),
});

type RangeQuery = z.infer<typeof rangeQuery>;

export interface AnalyticsRouterDeps {
  prisma: PrismaClient;
  analytics: AnalyticsService;
}

function orgId(req: Request): string {
  return req.orgContext!.organizationId;
}

function rangeOf(req: Request) {
  return rangeForDays(getValidated<RangeQuery>(req, "query").days);
}

/**
 * Read-only analytics surface under
 * /v1/organizations/:organizationId/analytics. Gated by `monitor:read` (the
 * data is monitor telemetry; no separate analytics RBAC resource exists).
 */
export function analyticsRouter(deps: AnalyticsRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));
  const read = requirePermission("monitor", "read");

  router.get("/summary", read, validate({ query: rangeQuery }), async (req, res) => {
    res.json(await deps.analytics.summary(orgId(req), rangeOf(req)));
  });

  router.get("/timeseries", read, validate({ query: rangeQuery }), async (req, res) => {
    res.json(await deps.analytics.timeseries(orgId(req), rangeOf(req)));
  });

  router.get("/regions", read, validate({ query: rangeQuery }), async (req, res) => {
    res.json(await deps.analytics.regions(orgId(req), rangeOf(req)));
  });

  router.get("/incidents", read, validate({ query: rangeQuery }), async (req, res) => {
    res.json(await deps.analytics.incidents(orgId(req), rangeOf(req)));
  });

  router.get("/sla", read, validate({ query: rangeQuery }), async (req, res) => {
    res.json(await deps.analytics.sla(orgId(req), rangeOf(req)));
  });

  router.get("/monitors/:monitorId", read, validate({ query: rangeQuery }), async (req, res) => {
    const monitorId = req.params.monitorId;
    if (typeof monitorId !== "string" || monitorId.length === 0) {
      throw AppError.notFound("Monitor not found.");
    }
    const result = await deps.analytics.monitor(orgId(req), monitorId, rangeOf(req));
    if (!result) throw AppError.notFound("Monitor not found.");
    res.json(result);
  });

  return router;
}
