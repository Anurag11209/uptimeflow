import { AppError, buildPage, type Page } from "@backend-uptime/shared";
import type { AlertChannelType, Prisma, PrismaClient } from "@backend-uptime/db";
import { parseCursor } from "./cursor.js";
import { afterCursorDesc } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { PlanLimitsService } from "./plan-limits.service.js";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface CreateAlertChannelInput {
  type: AlertChannelType;
  name: string;
  /** Provider-specific config. Callers are responsible for not storing raw secrets. */
  config: Record<string, unknown>;
}

export type UpdateAlertChannelInput = Partial<CreateAlertChannelInput>;

export interface AlertChannelActor {
  userId: string | null;
  actorType: "user" | "api_key";
}

// ─── Query types ──────────────────────────────────────────────────────────────

export interface AlertChannelListQuery {
  limit: number;
  cursor?: string;
  type?: AlertChannelType;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface AlertChannelItem {
  id: string;
  type: AlertChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  verifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AlertChannelDetail extends AlertChannelItem {
  /** IDs of monitors currently bound to this channel. */
  boundMonitorIds: string[];
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface AlertChannelService {
  list(organizationId: string, query: AlertChannelListQuery): Promise<Page<AlertChannelItem>>;
  get(organizationId: string, channelId: string): Promise<AlertChannelDetail | null>;
  create(
    organizationId: string,
    input: CreateAlertChannelInput,
    actor: AlertChannelActor,
  ): Promise<AlertChannelDetail>;
  update(
    organizationId: string,
    channelId: string,
    input: UpdateAlertChannelInput,
    actor: AlertChannelActor,
  ): Promise<AlertChannelDetail | null>;
  enable(
    organizationId: string,
    channelId: string,
    actor: AlertChannelActor,
  ): Promise<AlertChannelDetail | null>;
  disable(
    organizationId: string,
    channelId: string,
    actor: AlertChannelActor,
  ): Promise<AlertChannelDetail | null>;
  remove(organizationId: string, channelId: string, actor: AlertChannelActor): Promise<boolean>;
}

// ─── Prisma select shapes ─────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  type: true,
  name: true,
  config: true,
  enabled: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AlertChannelSelect;

const DETAIL_SELECT = {
  id: true,
  type: true,
  name: true,
  config: true,
  enabled: true,
  verifiedAt: true,
  createdAt: true,
  updatedAt: true,
  monitorBindings: { select: { monitorId: true } },
} satisfies Prisma.AlertChannelSelect;

type ListRow = Prisma.AlertChannelGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.AlertChannelGetPayload<{ select: typeof DETAIL_SELECT }>;

// ─── Row → DTO mappers ────────────────────────────────────────────────────────

function toItem(row: ListRow): AlertChannelItem {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config: row.config as Record<string, unknown>,
    enabled: row.enabled,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DetailRow): AlertChannelDetail {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    config: row.config as Record<string, unknown>,
    enabled: row.enabled,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    boundMonitorIds: row.monitorBindings.map((b) => b.monitorId),
  };
}

/** Channel types that require a paid plan capability. */
const GATED_TYPES: Partial<Record<AlertChannelType, "sms" | "voice">> = {
  SMS: "sms",
  VOICE: "voice",
};

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAlertChannelService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
  planLimits: PlanLimitsService;
}): AlertChannelService {
  const { prisma, auditLogs, planLimits } = deps;

  async function loadDetail(
    organizationId: string,
    channelId: string,
  ): Promise<AlertChannelDetail | null> {
    const row = await prisma.alertChannel.findFirst({
      where: { id: channelId, organizationId, deletedAt: null },
      select: DETAIL_SELECT,
    });
    return row ? toDetail(row) : null;
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);

      const conditions: Prisma.AlertChannelWhereInput[] = [{ organizationId, deletedAt: null }];
      if (query.type) conditions.push({ type: query.type });
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.alertChannel.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: LIST_SELECT,
      });

      return buildPage(rows.map(toItem), query.limit);
    },

    get: (organizationId, channelId) => loadDetail(organizationId, channelId),

    async create(organizationId, input, actor) {
      // Check plan capability for gated channel types.
      const requiredCapability = GATED_TYPES[input.type];
      if (requiredCapability) {
        await planLimits.assertCapability(organizationId, requiredCapability);
      }

      const channel = await prisma.alertChannel.create({
        data: {
          organizationId,
          type: input.type,
          name: input.name,
          config: input.config as Prisma.JsonObject,
          createdById: actor.userId ?? undefined,
        },
        select: DETAIL_SELECT,
      });

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "alert_channel.created",
        resourceType: "alertChannel",
        resourceId: channel.id,
      });

      return toDetail(channel);
    },

    async update(organizationId, channelId, input, actor) {
      const existing = await prisma.alertChannel.findFirst({
        where: { id: channelId, organizationId, deletedAt: null },
        select: { id: true, type: true },
      });
      if (!existing) return null;

      // If changing type, check capability for the new type.
      if (input.type && input.type !== existing.type) {
        const requiredCapability = GATED_TYPES[input.type];
        if (requiredCapability) {
          await planLimits.assertCapability(organizationId, requiredCapability);
        }
      }

      const data: Prisma.AlertChannelUpdateInput = { updatedById: actor.userId ?? undefined };
      if (input.name !== undefined) data.name = input.name;
      if (input.type !== undefined) data.type = input.type;
      if (input.config !== undefined) data.config = input.config as Prisma.JsonObject;

      await prisma.alertChannel.update({ where: { id: channelId }, data });

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "alert_channel.updated",
        resourceType: "alertChannel",
        resourceId: channelId,
      });

      return loadDetail(organizationId, channelId);
    },

    async enable(organizationId, channelId, actor) {
      const existing = await prisma.alertChannel.findFirst({
        where: { id: channelId, organizationId, deletedAt: null },
        select: { id: true, enabled: true },
      });
      if (!existing) return null;

      if (!existing.enabled) {
        await prisma.alertChannel.update({
          where: { id: channelId },
          data: { enabled: true, updatedById: actor.userId ?? undefined },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "alert_channel.enabled",
          resourceType: "alertChannel",
          resourceId: channelId,
        });
      }

      return loadDetail(organizationId, channelId);
    },

    async disable(organizationId, channelId, actor) {
      const existing = await prisma.alertChannel.findFirst({
        where: { id: channelId, organizationId, deletedAt: null },
        select: { id: true, enabled: true },
      });
      if (!existing) return null;

      if (existing.enabled) {
        await prisma.alertChannel.update({
          where: { id: channelId },
          data: { enabled: false, updatedById: actor.userId ?? undefined },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "alert_channel.disabled",
          resourceType: "alertChannel",
          resourceId: channelId,
        });
      }

      return loadDetail(organizationId, channelId);
    },

    async remove(organizationId, channelId, actor) {
      const result = await prisma.alertChannel.updateMany({
        where: { id: channelId, organizationId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId ?? undefined },
      });
      if (result.count === 0) return false;

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "alert_channel.deleted",
        resourceType: "alertChannel",
        resourceId: channelId,
      });
      return true;
    },
  };
}
