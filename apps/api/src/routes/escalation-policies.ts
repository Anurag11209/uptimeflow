import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  Actor,
  EscalationPolicyService,
  UpsertEscalationPolicyInput,
} from "../services/escalation-policy.service.js";

const targetSchema = z
  .object({
    type: z.enum(["USER", "SCHEDULE", "CHANNEL"]),
    userId: z.string().max(64).optional(),
    scheduleId: z.string().uuid().optional(),
    channelId: z.string().uuid().optional(),
  })
  .strict();

const stepSchema = z.object({
  delayMinutes: z.number().int().min(0).max(1440),
  targets: z.array(targetSchema).min(1).max(10),
});

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional(),
  repeatCount: z.number().int().min(0).max(10).optional(),
  steps: z.array(stepSchema).min(1).max(20),
});

export interface EscalationPoliciesRouterDeps {
  prisma: PrismaClient;
  escalationPolicies: EscalationPolicyService;
}

function actorOf(req: Request): Actor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
  };
}

function idOf(req: Request): string {
  const id = req.params.policyId;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Escalation policy not found.");
  return id;
}

/**
 * Escalation policy CRUD under
 * /v1/organizations/:organizationId/escalation-policies, gated by the
 * `escalationPolicy` RBAC resource. orgContext enforces tenant isolation.
 */
export function escalationPoliciesRouter(deps: EscalationPoliciesRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("escalationPolicy", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<{ limit: number; cursor?: string }>(req, "query");
      res.json(await deps.escalationPolicies.list(req.orgContext!.organizationId, query));
    },
  );

  router.post(
    "/",
    requirePermission("escalationPolicy", "create"),
    validate({ body: upsertSchema }),
    async (req, res) => {
      const body = getValidated<UpsertEscalationPolicyInput>(req, "body");
      const created = await deps.escalationPolicies.create(req.orgContext!.organizationId, body, actorOf(req));
      res.status(201).json(created);
    },
  );

  router.get("/:policyId", requirePermission("escalationPolicy", "read"), async (req, res) => {
    const policy = await deps.escalationPolicies.get(req.orgContext!.organizationId, idOf(req));
    if (!policy) throw AppError.notFound("Escalation policy not found.");
    res.json(policy);
  });

  router.put(
    "/:policyId",
    requirePermission("escalationPolicy", "update"),
    validate({ body: upsertSchema }),
    async (req, res) => {
      const body = getValidated<UpsertEscalationPolicyInput>(req, "body");
      const updated = await deps.escalationPolicies.update(req.orgContext!.organizationId, idOf(req), body, actorOf(req));
      if (!updated) throw AppError.notFound("Escalation policy not found.");
      res.json(updated);
    },
  );

  router.delete("/:policyId", requirePermission("escalationPolicy", "delete"), async (req, res) => {
    const ok = await deps.escalationPolicies.remove(req.orgContext!.organizationId, idOf(req), actorOf(req));
    if (!ok) throw AppError.notFound("Escalation policy not found.");
    res.status(204).end();
  });

  return router;
}
