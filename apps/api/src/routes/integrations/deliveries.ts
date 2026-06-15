import { Router } from "express";
import { z } from "zod";
import { buildPage, paginationQuerySchema } from "@backend-uptime/shared";
import type { Prisma, PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../../middleware/org-context.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { getValidated, validate } from "../../middleware/validate.js";
import { afterCursorDesc, parseCursor } from "../../services/cursor.js";

const querySchema = paginationQuerySchema.extend({
  integrationType: z.enum(["SLACK", "DISCORD", "WEBHOOK"]).optional(),
  integrationId: z.string().uuid().optional(),
});

const SELECT = {
  id: true,
  integrationType: true,
  integrationId: true,
  event: true,
  status: true,
  attempts: true,
  responseStatus: true,
  error: true,
  sentAt: true,
  createdAt: true,
} satisfies Prisma.IntegrationDeliverySelect;

export interface DeliveriesRouterDeps {
  prisma: PrismaClient;
}

/**
 * Read-only integration delivery history under
 * /v1/organizations/:organizationId/integrations/deliveries. Powers the UI's
 * delivery log + last success/failure. Org-scoped, gated by alertChannel:read,
 * keyset-paginated newest-first.
 */
export function integrationDeliveriesRouter(deps: DeliveriesRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("alertChannel", "read"),
    validate({ query: querySchema }),
    async (req, res) => {
      const query = getValidated<z.infer<typeof querySchema>>(req, "query");
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.IntegrationDeliveryWhereInput[] = [
        { organizationId: req.orgContext!.organizationId },
      ];
      if (query.integrationType) conditions.push({ integrationType: query.integrationType });
      if (query.integrationId) conditions.push({ integrationId: query.integrationId });
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await deps.prisma.integrationDelivery.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: SELECT,
      });
      res.json(buildPage(rows, query.limit));
    },
  );

  return router;
}
