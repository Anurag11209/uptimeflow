import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  CustomDomainActor,
  CustomDomainService,
  ListQuery,
} from "../services/custom-domain.service.js";

const createSchema = z.object({
  statusPageId: z.string().uuid(),
  domain: z.string().trim().min(3).max(253),
});

type CreateBody = z.infer<typeof createSchema>;

function actorOf(req: Request): CustomDomainActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function idOf(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Custom domain not found.");
  return id;
}

export interface CustomDomainsRouterDeps {
  prisma: PrismaClient;
  service: CustomDomainService;
}

/**
 * /v1/organizations/:organizationId/custom-domains
 *
 * Custom domains are status-page configuration, so they reuse the `statusPage`
 * RBAC resource (read/create/update/delete). orgContext enforces tenancy. The
 * plan-capability gate (Phase 11D) is applied inside service.create, so an
 * over-plan attempt returns a typed 402 rather than a 403.
 */
export function customDomainsRouter(deps: CustomDomainsRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("statusPage", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<ListQuery>(req, "query");
      res.json(await deps.service.list(req.orgContext!.organizationId, query));
    },
  );

  router.post(
    "/",
    requirePermission("statusPage", "create"),
    validate({ body: createSchema }),
    async (req, res) => {
      const input = getValidated<CreateBody>(req, "body");
      const created = await deps.service.create(req.orgContext!.organizationId, input, actorOf(req));
      res.status(201).json(created);
    },
  );

  router.get("/:id", requirePermission("statusPage", "read"), async (req, res) => {
    const found = await deps.service.get(req.orgContext!.organizationId, idOf(req));
    if (!found) throw AppError.notFound("Custom domain not found.");
    res.json(found);
  });

  router.post("/:id/verify", requirePermission("statusPage", "update"), async (req, res) => {
    const result = await deps.service.verify(req.orgContext!.organizationId, idOf(req));
    if (!result) throw AppError.notFound("Custom domain not found.");
    res.json(result);
  });

  router.delete("/:id", requirePermission("statusPage", "delete"), async (req, res) => {
    const ok = await deps.service.remove(req.orgContext!.organizationId, idOf(req), actorOf(req));
    if (!ok) throw AppError.notFound("Custom domain not found.");
    res.status(204).end();
  });

  return router;
}
