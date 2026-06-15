import { randomBytes } from "node:crypto";
import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import type { IntegrationEvent } from "@backend-uptime/notifications";
import { orgContext } from "../../middleware/org-context.js";
import { requirePermission } from "../../middleware/require-permission.js";
import { getValidated, validate } from "../../middleware/validate.js";
import {
  createIntegrationService,
  type IntegrationActor,
  type IntegrationDelegate,
  type IntegrationListQuery,
} from "../../services/integration.service.js";
import type { AuditLogService } from "../../services/audit-log.service.js";
import { actorOf, maskSecret, nameSchema } from "./common.js";

export interface WebhookIntegrationSummary {
  id: string;
  name: string;
  endpoint: string;
  secretPreview: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const endpointSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((u) => u.startsWith("https://"), "Endpoint must be an HTTPS URL.");

const createSchema = z.object({
  name: nameSchema,
  endpoint: endpointSchema,
  // Optional: a secret is generated and returned once if omitted.
  secret: z.string().min(16).max(256).optional(),
  enabled: z.boolean().optional(),
});

const updateSchema = z
  .object({ name: nameSchema, endpoint: endpointSchema, secret: z.string().min(16).max(256), enabled: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

type WebhookCreate = z.infer<typeof createSchema>;
type WebhookUpdate = z.infer<typeof updateSchema>;

const SELECT = {
  id: true,
  name: true,
  endpoint: true,
  secret: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSummary(row: Record<string, unknown>): WebhookIntegrationSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    endpoint: row.endpoint as string,
    secretPreview: maskSecret(row.secret as string | null),
    enabled: row.enabled as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function createData(input: WebhookCreate & { secret: string }, ctx: { organizationId: string; actor: IntegrationActor }) {
  return {
    organizationId: ctx.organizationId,
    name: input.name,
    endpoint: input.endpoint,
    secret: input.secret,
    enabled: input.enabled ?? true,
    createdById: ctx.actor.userId,
    updatedById: ctx.actor.userId,
  };
}

function updateData(input: WebhookUpdate, actor: IntegrationActor) {
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (input.name !== undefined) data.name = input.name;
  if (input.endpoint !== undefined) data.endpoint = input.endpoint;
  if (input.secret !== undefined) data.secret = input.secret;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return data;
}

const testEvent = (summary: WebhookIntegrationSummary): IntegrationEvent => ({
  event: "test",
  title: `Test event from ${summary.name}`,
  summary: "Your UptimeFlow webhook integration is connected and working.",
  status: "OK",
  timestamp: new Date().toISOString(),
});

function generateSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

function idOf(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Integration not found.");
  return id;
}

export interface WebhookRouterDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dispatcher?: IntegrationDispatcher;
}

/**
 * /v1/organizations/:organizationId/integrations/webhooks. Custom (not the
 * generic factory) so that POST can generate a signing secret when one isn't
 * supplied and reveal it exactly once in the 201 response; reads only ever
 * return a masked preview.
 */
export function webhookIntegrationRouter(deps: WebhookRouterDeps): Router {
  const service = createIntegrationService<WebhookIntegrationSummary, WebhookCreate & { secret: string }, WebhookUpdate>(
    { auditLogs: deps.auditLogs },
    {
      delegate: deps.prisma.webhookIntegration as unknown as IntegrationDelegate,
      select: SELECT,
      resourceLabel: "webhook_integration",
      toSummary,
      createData,
      updateData,
    },
  );

  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("alertChannel", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<IntegrationListQuery>(req, "query");
      res.json(await service.list(req.orgContext!.organizationId, query));
    },
  );

  router.post(
    "/",
    requirePermission("alertChannel", "create"),
    validate({ body: createSchema }),
    async (req, res) => {
      const input = getValidated<WebhookCreate>(req, "body");
      const secret = input.secret ?? generateSecret();
      const created = await service.create(req.orgContext!.organizationId, { ...input, secret }, actorOf(req));
      // Reveal the secret exactly once so the customer can verify signatures.
      res.status(201).json({ ...created, secret });
    },
  );

  router.get("/:id", requirePermission("alertChannel", "read"), async (req, res) => {
    const found = await service.get(req.orgContext!.organizationId, idOf(req));
    if (!found) throw AppError.notFound("Integration not found.");
    res.json(found);
  });

  router.patch(
    "/:id",
    requirePermission("alertChannel", "update"),
    validate({ body: updateSchema }),
    async (req, res) => {
      const input = getValidated<WebhookUpdate>(req, "body");
      const updated = await service.update(req.orgContext!.organizationId, idOf(req), input, actorOf(req));
      if (!updated) throw AppError.notFound("Integration not found.");
      res.json(updated);
    },
  );

  router.delete("/:id", requirePermission("alertChannel", "delete"), async (req, res) => {
    const ok = await service.remove(req.orgContext!.organizationId, idOf(req), actorOf(req));
    if (!ok) throw AppError.notFound("Integration not found.");
    res.status(204).end();
  });

  router.post("/:id/test", requirePermission("alertChannel", "update"), async (req, res) => {
    const organizationId = req.orgContext!.organizationId;
    const id = idOf(req);
    const summary = await service.get(organizationId, id);
    if (!summary) throw AppError.notFound("Integration not found.");
    if (!deps.dispatcher) throw new AppError("service_unavailable", "Integration delivery is not configured.");
    const deliveryId = await deps.dispatcher.dispatchTest({
      organizationId,
      integrationType: "WEBHOOK",
      integrationId: id,
      event: testEvent(summary),
    });
    res.status(202).json({ queued: true, deliveryId });
  });

  return router;
}
