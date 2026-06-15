import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { IncidentActor, IncidentListQuery, IncidentService } from "../services/incident.service.js";

const listQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"]).optional(),
  monitorId: z.string().uuid().optional(),
});

const commentSchema = z.object({ message: z.string().trim().min(1).max(2000) });

export interface IncidentsRouterDeps {
  prisma: PrismaClient;
  incidents: IncidentService;
}

/** The acting principal for an incident mutation (member or API key). */
function actorOf(req: Request): IncidentActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function incidentIdOf(req: Request): string {
  const id = req.params.incidentId;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Incident not found.");
  return id;
}

/**
 * Incident management under /v1/organizations/:organizationId/incidents. Gated
 * by the `monitor` RBAC resource: read to view incidents/timeline, update to
 * acknowledge / resolve / comment. orgContext enforces tenant isolation (404 to
 * non-members and across orgs).
 */
export function incidentsRouter(deps: IncidentsRouterDeps): Router {
  const router = Router({ mergeParams: true });

  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("monitor", "read"),
    validate({ query: listQuerySchema }),
    async (req, res) => {
      const query = getValidated<IncidentListQuery>(req, "query");
      res.json(await deps.incidents.list(req.orgContext!.organizationId, query));
    },
  );

  router.get("/:incidentId", requirePermission("monitor", "read"), async (req, res) => {
    const detail = await deps.incidents.get(req.orgContext!.organizationId, incidentIdOf(req));
    if (!detail) throw AppError.notFound("Incident not found.");
    res.json(detail);
  });

  router.post("/:incidentId/acknowledge", requirePermission("monitor", "update"), async (req, res) => {
    const detail = await deps.incidents.acknowledge(
      req.orgContext!.organizationId,
      incidentIdOf(req),
      actorOf(req),
    );
    if (!detail) throw AppError.notFound("Incident not found.");
    res.json(detail);
  });

  router.post("/:incidentId/resolve", requirePermission("monitor", "update"), async (req, res) => {
    const detail = await deps.incidents.resolve(
      req.orgContext!.organizationId,
      incidentIdOf(req),
      actorOf(req),
    );
    if (!detail) throw AppError.notFound("Incident not found.");
    res.json(detail);
  });

  router.post(
    "/:incidentId/comment",
    requirePermission("monitor", "update"),
    validate({ body: commentSchema }),
    async (req, res) => {
      const { message } = getValidated<{ message: string }>(req, "body");
      const event = await deps.incidents.comment(
        req.orgContext!.organizationId,
        incidentIdOf(req),
        message,
        actorOf(req),
      );
      if (!event) throw AppError.notFound("Incident not found.");
      res.status(201).json(event);
    },
  );

  return router;
}
