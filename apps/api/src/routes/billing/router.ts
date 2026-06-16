import { Router, type Request } from "express";
import { z } from "zod";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../../middleware/org-context.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { getValidated, validate } from "../../middleware/validate.js";
import type { BillingActor, BillingService } from "../../services/billing.service.js";

// Tiers a customer can self-serve onto (FREE has no price; ENTERPRISE is sales-led).
const purchasableTierSchema = z.enum(["STARTER", "GROWTH", "BUSINESS"]);

const checkoutSchema = z.object({
  tier: purchasableTierSchema,
  quantity: z.number().int().min(1).max(1000).optional(),
});

const changePlanSchema = z.object({
  tier: purchasableTierSchema,
  quantity: z.number().int().min(1).max(1000).optional(),
});

const cancelSchema = z.object({
  // Default to graceful cancel (keep access until the paid period ends).
  atPeriodEnd: z.boolean().optional().default(true),
});

const invoicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

type CheckoutBody = z.infer<typeof checkoutSchema>;
type ChangePlanBody = z.infer<typeof changePlanSchema>;
type CancelBody = z.infer<typeof cancelSchema>;

function billingActorOf(req: Request): BillingActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    email: req.sessionData?.user?.email ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

export interface BillingRouterDeps {
  prisma: PrismaClient;
  billing: BillingService;
}

/**
 * /v1/organizations/:organizationId/billing
 *
 * Reads are gated by `billing:read`; mutations (checkout, portal, plan change,
 * cancel) by `billing:manage` — the same RBAC matrix already used elsewhere, so
 * only owners (and, for reads, admins/managers) reach billing. orgContext
 * enforces tenant isolation.
 */
export function billingRouter(deps: BillingRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get("/", requirePermission("billing", "read"), async (req, res) => {
    res.json(await deps.billing.getSummary(req.orgContext!.organizationId));
  });

  router.get("/plans", requirePermission("billing", "read"), async (_req, res) => {
    res.json({ plans: await deps.billing.listPlans() });
  });

  router.get(
    "/invoices",
    requirePermission("billing", "read"),
    validate({ query: invoicesQuerySchema }),
    async (req, res) => {
      const { limit } = getValidated<{ limit: number }>(req, "query");
      res.json({ items: await deps.billing.listInvoices(req.orgContext!.organizationId, limit) });
    },
  );

  router.post(
    "/checkout",
    requirePermission("billing", "manage"),
    validate({ body: checkoutSchema }),
    async (req, res) => {
      const input = getValidated<CheckoutBody>(req, "body");
      const { url } = await deps.billing.startCheckout(
        req.orgContext!.organizationId,
        input,
        billingActorOf(req),
        req.orgContext!.organization.name,
      );
      res.status(201).json({ url });
    },
  );

  router.post("/portal", requirePermission("billing", "manage"), async (req, res) => {
    const { url } = await deps.billing.openPortal(req.orgContext!.organizationId, billingActorOf(req));
    res.status(201).json({ url });
  });

  router.post(
    "/change-plan",
    requirePermission("billing", "manage"),
    validate({ body: changePlanSchema }),
    async (req, res) => {
      const input = getValidated<ChangePlanBody>(req, "body");
      await deps.billing.changePlan(req.orgContext!.organizationId, input, billingActorOf(req));
      res.status(204).end();
    },
  );

  router.post(
    "/cancel",
    requirePermission("billing", "manage"),
    validate({ body: cancelSchema }),
    async (req, res) => {
      const input = getValidated<CancelBody>(req, "body");
      await deps.billing.cancel(req.orgContext!.organizationId, input, billingActorOf(req));
      res.status(204).end();
    },
  );

  return router;
}
