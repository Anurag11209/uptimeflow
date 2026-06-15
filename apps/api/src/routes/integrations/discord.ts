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

export interface DiscordIntegrationSummary {
  id: string;
  name: string;
  webhookUrlPreview: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const webhookUrlSchema = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine(
    (u) => /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\//.test(u),
    "Must be a Discord channel webhook URL (https://discord.com/api/webhooks/...).",
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

type DiscordCreate = z.infer<typeof createSchema>;
type DiscordUpdate = z.infer<typeof updateSchema>;

const SELECT = {
  id: true,
  name: true,
  webhookUrl: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSummary(row: Record<string, unknown>): DiscordIntegrationSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    webhookUrlPreview: maskSecret(row.webhookUrl as string),
    enabled: row.enabled as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function createData(input: DiscordCreate, ctx: { organizationId: string; actor: IntegrationActor }) {
  return {
    organizationId: ctx.organizationId,
    name: input.name,
    webhookUrl: input.webhookUrl,
    enabled: input.enabled ?? true,
    createdById: ctx.actor.userId,
    updatedById: ctx.actor.userId,
  };
}

function updateData(input: DiscordUpdate, actor: IntegrationActor) {
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (input.name !== undefined) data.name = input.name;
  if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return data;
}

const testEvent = (summary: DiscordIntegrationSummary): IntegrationEvent => ({
  event: "test",
  title: `Test notification from ${summary.name}`,
  summary: "Your UptimeFlow Discord integration is connected and working.",
  status: "OK",
  timestamp: new Date().toISOString(),
});

export interface DiscordRouterDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dispatcher?: IntegrationDispatcher;
}

/** /v1/organizations/:organizationId/integrations/discord */
export function discordIntegrationRouter(deps: DiscordRouterDeps): Router {
  const service = createIntegrationService<DiscordIntegrationSummary, DiscordCreate, DiscordUpdate>(
    { auditLogs: deps.auditLogs },
    {
      delegate: deps.prisma.discordIntegration as unknown as IntegrationDelegate,
      select: SELECT,
      resourceLabel: "discord_integration",
      toSummary,
      createData,
      updateData,
    },
  );
  return integrationsRouter<DiscordIntegrationSummary, DiscordCreate, DiscordUpdate>({
    prisma: deps.prisma,
    service,
    integrationType: "DISCORD",
    createSchema,
    updateSchema,
    testEvent,
    dispatcher: deps.dispatcher,
  });
}
