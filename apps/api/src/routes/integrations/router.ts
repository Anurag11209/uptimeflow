import { Router, type Request } from "express";
import type { ZodType } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient, IntegrationType } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import type { IntegrationEvent } from "@backend-uptime/notifications";
import { orgContext } from "../../middleware/org-context.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { getValidated, validate } from "../../middleware/validate.js";
import type { IntegrationListQuery, IntegrationService } from "../../services/integration.service.js";
import { actorOf } from "./common.js";

export interface IntegrationsRouterDeps<TSummary, TCreate, TUpdate> {
  prisma: PrismaClient;
  service: IntegrationService<TSummary, TCreate, TUpdate>;
  integrationType: IntegrationType;
  createSchema: ZodType<TCreate>;
  updateSchema: ZodType<TUpdate>;
  /** Builds the event sent by POST /:id/test; receives the stored summary. */
  testEvent: (summary: TSummary) => IntegrationEvent;
  /** Dispatcher used by the test endpoint; absent in unit tests of pure CRUD. */
  dispatcher?: IntegrationDispatcher;
}

function idOf(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Integration not found.");
  return id;
}

/**
 * Generic CRUD + test router for one integration provider, mounted under
 * /v1/organizations/:organizationId/integrations/<provider>. Gated by the
 * `alertChannel` RBAC resource (integrations are alert channels); orgContext
 * enforces tenant isolation. The /:id/test action enqueues a single delivery
 * via the integration dispatcher so the user can validate their webhook.
 */
export function integrationsRouter<TSummary, TCreate, TUpdate>(
  deps: IntegrationsRouterDeps<TSummary, TCreate, TUpdate>,
): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("alertChannel", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<IntegrationListQuery>(req, "query");
      res.json(await deps.service.list(req.orgContext!.organizationId, query));
    },
  );

  router.post(
    "/",
    requirePermission("alertChannel", "create"),
    validate({ body: deps.createSchema }),
    async (req, res) => {
      const input = getValidated<TCreate>(req, "body");
      const created = await deps.service.create(req.orgContext!.organizationId, input, actorOf(req));
      res.status(201).json(created);
    },
  );

  router.get("/:id", requirePermission("alertChannel", "read"), async (req, res) => {
    const found = await deps.service.get(req.orgContext!.organizationId, idOf(req));
    if (!found) throw AppError.notFound("Integration not found.");
    res.json(found);
  });

  router.patch(
    "/:id",
    requirePermission("alertChannel", "update"),
    validate({ body: deps.updateSchema }),
    async (req, res) => {
      const input = getValidated<TUpdate>(req, "body");
      const updated = await deps.service.update(req.orgContext!.organizationId, idOf(req), input, actorOf(req));
      if (!updated) throw AppError.notFound("Integration not found.");
      res.json(updated);
    },
  );

  router.delete("/:id", requirePermission("alertChannel", "delete"), async (req, res) => {
    const ok = await deps.service.remove(req.orgContext!.organizationId, idOf(req), actorOf(req));
    if (!ok) throw AppError.notFound("Integration not found.");
    res.status(204).end();
  });

  router.post("/:id/test", requirePermission("alertChannel", "update"), async (req, res) => {
    const organizationId = req.orgContext!.organizationId;
    const id = idOf(req);
    const summary = await deps.service.get(organizationId, id);
    if (!summary) throw AppError.notFound("Integration not found.");
    if (!deps.dispatcher) {
      throw new AppError("service_unavailable", "Integration delivery is not configured.");
    }
    const deliveryId = await deps.dispatcher.dispatchTest({
      organizationId,
      integrationType: deps.integrationType,
      integrationId: id,
      event: deps.testEvent(summary),
    });
    res.status(202).json({ queued: true, deliveryId });
  });

  return router;
}
