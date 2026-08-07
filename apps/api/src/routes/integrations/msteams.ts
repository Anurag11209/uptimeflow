import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import type { IntegrationEvent } from "@backend-uptime/notifications";
import {
  createIntegrationService,
  type IntegrationActor,
  type IntegrationDelegate,
} from "../../services/integration.service.js";
import type { AuditLogService } from "../../services/audit-log.service.js";
import { integrationsRouter } from "./router.js";
import { maskSecret, nameSchema } from "./common.js";

export interface MsTeamsIntegrationSummary {
  id: string;
  name: string;
  webhookUrlPreview: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Accepts both Teams webhook shapes:
 *  - Workflows / Power Automate HTTP trigger (the supported path today), which
 *    is hosted on *.logic.azure.com or *.powerplatform.com;
 *  - the retired Office 365 connector (outlook.office.com/webhook/...), so
 *    tenants that have not finished migrating are not locked out.
 */
const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (u) =>
      /^https:\/\/[a-z0-9-]+\.logic\.azure\.com(?::\d+)?\//i.test(u) ||
      /^https:\/\/[a-z0-9.-]*powerplatform\.com\//i.test(u) ||
      /^https:\/\/[a-z0-9.-]*(?:outlook\.office|office)\.com\/webhook/i.test(u),
    "Must be a Microsoft Teams webhook URL (Workflows/Power Automate, or a legacy Office 365 connector).",
  );

const createSchema = z.object({
  name: nameSchema,
  webhookUrl: webhookUrlSchema,
  enabled: z.boolean().optional(),
});

const updateSchema = z
  .object({ name: nameSchema, webhookUrl: webhookUrlSchema, enabled: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

type MsTeamsCreate = z.infer<typeof createSchema>;
type MsTeamsUpdate = z.infer<typeof updateSchema>;

const SELECT = {
  id: true,
  name: true,
  webhookUrl: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSummary(row: Record<string, unknown>): MsTeamsIntegrationSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    webhookUrlPreview: maskSecret(row.webhookUrl as string),
    enabled: row.enabled as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function createData(input: MsTeamsCreate, ctx: { organizationId: string; actor: IntegrationActor }) {
  return {
    organizationId: ctx.organizationId,
    name: input.name,
    webhookUrl: input.webhookUrl,
    enabled: input.enabled ?? true,
    createdById: ctx.actor.userId,
    updatedById: ctx.actor.userId,
  };
}

function updateData(input: MsTeamsUpdate, actor: IntegrationActor) {
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (input.name !== undefined) data.name = input.name;
  if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return data;
}

const testEvent = (summary: MsTeamsIntegrationSummary): IntegrationEvent => ({
  event: "test",
  title: `Test notification from ${summary.name}`,
  summary: "Your UptimeFlow Microsoft Teams integration is connected and working.",
  status: "OK",
  timestamp: new Date().toISOString(),
});

export interface MsTeamsRouterDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dispatcher?: IntegrationDispatcher;
}

/** /v1/organizations/:organizationId/integrations/msteams */
export function msTeamsIntegrationRouter(deps: MsTeamsRouterDeps): Router {
  const service = createIntegrationService<MsTeamsIntegrationSummary, MsTeamsCreate, MsTeamsUpdate>(
    { auditLogs: deps.auditLogs },
    {
      delegate: deps.prisma.msTeamsIntegration as unknown as IntegrationDelegate,
      select: SELECT,
      resourceLabel: "ms_teams_integration",
      toSummary,
      createData,
      updateData,
    },
  );
  return integrationsRouter<MsTeamsIntegrationSummary, MsTeamsCreate, MsTeamsUpdate>({
    prisma: deps.prisma,
    service,
    integrationType: "MICROSOFT_TEAMS",
    createSchema,
    updateSchema,
    testEvent,
    dispatcher: deps.dispatcher,
  });
}
