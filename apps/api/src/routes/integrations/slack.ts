import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import type { IntegrationEvent } from "@backend-uptime/notifications";
import {
  createIntegrationService,
  type IntegrationDelegate,
  type IntegrationActor,
} from "../../services/integration.service.js";
import type { AuditLogService } from "../../services/audit-log.service.js";
import { integrationsRouter } from "./router.js";
import { maskSecret, nameSchema } from "./common.js";

export interface SlackIntegrationSummary {
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
  .refine((u) => u.startsWith("https://hooks.slack.com/"), "Must be a Slack Incoming Webhook URL (https://hooks.slack.com/...).");

const createSchema = z.object({
  name: nameSchema,
  webhookUrl: webhookUrlSchema,
  enabled: z.boolean().optional(),
});

const updateSchema = z
  .object({ name: nameSchema, webhookUrl: webhookUrlSchema, enabled: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

type SlackCreate = z.infer<typeof createSchema>;
type SlackUpdate = z.infer<typeof updateSchema>;

const SELECT = {
  id: true,
  name: true,
  webhookUrl: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSummary(row: Record<string, unknown>): SlackIntegrationSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    webhookUrlPreview: maskSecret(row.webhookUrl as string),
    enabled: row.enabled as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function createData(input: SlackCreate, ctx: { organizationId: string; actor: IntegrationActor }) {
  return {
    organizationId: ctx.organizationId,
    name: input.name,
    webhookUrl: input.webhookUrl,
    enabled: input.enabled ?? true,
    createdById: ctx.actor.userId,
    updatedById: ctx.actor.userId,
  };
}

function updateData(input: SlackUpdate, actor: IntegrationActor) {
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (input.name !== undefined) data.name = input.name;
  if (input.webhookUrl !== undefined) data.webhookUrl = input.webhookUrl;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return data;
}

const testEvent = (summary: SlackIntegrationSummary): IntegrationEvent => ({
  event: "test",
  title: `Test notification from ${summary.name}`,
  summary: "Your UptimeFlow Slack integration is connected and working.",
  status: "OK",
  timestamp: new Date().toISOString(),
});

export interface SlackRouterDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dispatcher?: IntegrationDispatcher;
}

/** /v1/organizations/:organizationId/integrations/slack */
export function slackIntegrationRouter(deps: SlackRouterDeps): Router {
  const service = createIntegrationService<SlackIntegrationSummary, SlackCreate, SlackUpdate>(
    { auditLogs: deps.auditLogs },
    {
      delegate: deps.prisma.slackIntegration as unknown as IntegrationDelegate,
      select: SELECT,
      resourceLabel: "slack_integration",
      toSummary,
      createData,
      updateData,
    },
  );
  return integrationsRouter<SlackIntegrationSummary, SlackCreate, SlackUpdate>({
    prisma: deps.prisma,
    service,
    integrationType: "SLACK",
    createSchema,
    updateSchema,
    testEvent,
    dispatcher: deps.dispatcher,
  });
}
