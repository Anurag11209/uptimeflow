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

export interface TelegramIntegrationSummary {
  id: string;
  name: string;
  /** Never the raw token — reads only ever expose a masked suffix. */
  botTokenPreview: string | null;
  chatId: string;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Bot tokens from @BotFather look like `<botId>:<35-char secret>`. */
const botTokenSchema = z
  .string()
  .trim()
  .min(20)
  .max(200)
  .refine(
    (t) => /^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(t),
    "Must be a Telegram bot token from @BotFather (e.g. 123456789:AA...).",
  );

/** Chat ids are numeric; groups and channels are negative, users positive. */
const chatIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((c) => /^-?\d+$/.test(c), "Must be a numeric Telegram chat id (e.g. -1001234567890).");

const createSchema = z.object({
  name: nameSchema,
  botToken: botTokenSchema,
  chatId: chatIdSchema,
  enabled: z.boolean().optional(),
});

const updateSchema = z
  .object({ name: nameSchema, botToken: botTokenSchema, chatId: chatIdSchema, enabled: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

type TelegramCreate = z.infer<typeof createSchema>;
type TelegramUpdate = z.infer<typeof updateSchema>;

const SELECT = {
  id: true,
  name: true,
  botToken: true,
  chatId: true,
  enabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toSummary(row: Record<string, unknown>): TelegramIntegrationSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    botTokenPreview: maskSecret(row.botToken as string),
    chatId: row.chatId as string,
    enabled: row.enabled as boolean,
    createdAt: row.createdAt as Date,
    updatedAt: row.updatedAt as Date,
  };
}

function createData(input: TelegramCreate, ctx: { organizationId: string; actor: IntegrationActor }) {
  return {
    organizationId: ctx.organizationId,
    name: input.name,
    botToken: input.botToken,
    chatId: input.chatId,
    enabled: input.enabled ?? true,
    createdById: ctx.actor.userId,
    updatedById: ctx.actor.userId,
  };
}

function updateData(input: TelegramUpdate, actor: IntegrationActor) {
  const data: Record<string, unknown> = { updatedById: actor.userId };
  if (input.name !== undefined) data.name = input.name;
  if (input.botToken !== undefined) data.botToken = input.botToken;
  if (input.chatId !== undefined) data.chatId = input.chatId;
  if (input.enabled !== undefined) data.enabled = input.enabled;
  return data;
}

const testEvent = (summary: TelegramIntegrationSummary): IntegrationEvent => ({
  event: "test",
  title: `Test notification from ${summary.name}`,
  summary: "Your UptimeFlow Telegram integration is connected and working.",
  status: "OK",
  timestamp: new Date().toISOString(),
});

export interface TelegramRouterDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dispatcher?: IntegrationDispatcher;
}

/** /v1/organizations/:organizationId/integrations/telegram */
export function telegramIntegrationRouter(deps: TelegramRouterDeps): Router {
  const service = createIntegrationService<
    TelegramIntegrationSummary,
    TelegramCreate,
    TelegramUpdate
  >(
    { auditLogs: deps.auditLogs },
    {
      delegate: deps.prisma.telegramIntegration as unknown as IntegrationDelegate,
      select: SELECT,
      resourceLabel: "telegram_integration",
      toSummary,
      createData,
      updateData,
    },
  );
  return integrationsRouter<TelegramIntegrationSummary, TelegramCreate, TelegramUpdate>({
    prisma: deps.prisma,
    service,
    integrationType: "TELEGRAM",
    createSchema,
    updateSchema,
    testEvent,
    dispatcher: deps.dispatcher,
  });
}
