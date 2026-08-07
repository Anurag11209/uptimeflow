import { AppError, buildPage, type Page } from "@backend-uptime/shared";
import type { AlertChannelType, Prisma, PrismaClient } from "@backend-uptime/db";
import { resolveSlackWebhookUrl } from "@backend-uptime/monitoring";
import { SlackNotifier, type FetchLike } from "@backend-uptime/notifications";
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

export interface TestSendResult {
  ok: true;
  /** Stamped on the channel when a test message is actually accepted. */
  verifiedAt: Date;
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
  /** Send a real test notification now. Null when the channel doesn't exist. */
  test(
    organizationId: string,
    channelId: string,
    actor: AlertChannelActor,
  ): Promise<TestSendResult | null>;
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

/** Channel types this build can actually deliver to. Kept in sync with the
 *  worker's transport map (apps/worker/src/index.ts); anything else records a
 *  FAILED delivery rather than a phantom success. */
const TESTABLE_TYPES: AlertChannelType[] = ["SLACK"];

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createAlertChannelService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
  planLimits: PlanLimitsService;
  /** Injected in tests; defaults to the notifier's own hardened HTTP path. */
  fetchImpl?: FetchLike;
}): AlertChannelService {
  const { prisma, auditLogs, planLimits } = deps;

  /**
   * Validate provider-specific config before it is persisted.
   *
   * Deliberately narrow: only types with a real transport are checked. Applying
   * new rules to EMAIL/WEBHOOK/etc. would reject existing rows on an unrelated
   * edit (a rename would fail on config saved before the rule existed), so
   * those stay permissive until each gets a transport of its own.
   *
   * SLACK reuses `resolveSlackWebhookUrl` — the exact function the transport
   * calls at send time — so "valid at write time" and "deliverable at send
   * time" cannot drift apart.
   */
  async function assertValidConfig(
    organizationId: string,
    type: AlertChannelType,
    config: Record<string, unknown>,
  ): Promise<void> {
    if (type !== "SLACK") return;
    try {
      await resolveSlackWebhookUrl(prisma, organizationId, config);
    } catch (err) {
      throw new AppError(
        "validation_failed",
        err instanceof Error ? err.message : "Invalid Slack channel configuration.",
      );
    }
  }

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
      await assertValidConfig(organizationId, input.type, input.config);

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
        select: { id: true, type: true, config: true },
      });
      if (!existing) return null;

      // If changing type, check capability for the new type.
      if (input.type && input.type !== existing.type) {
        const requiredCapability = GATED_TYPES[input.type];
        if (requiredCapability) {
          await planLimits.assertCapability(organizationId, requiredCapability);
        }
      }

      // Validate against the post-update shape, not just the supplied fields:
      // switching type onto a config written for the old type must fail too.
      if (input.type !== undefined || input.config !== undefined) {
        await assertValidConfig(
          organizationId,
          input.type ?? existing.type,
          input.config ?? (existing.config as Record<string, unknown>),
        );
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

    /**
     * Send a real test notification and report the outcome synchronously.
     *
     * A deliberate exception to the queue-first rule (ADR-003): the whole point
     * of a test button is to answer "did that work?" while the operator is
     * looking at it. Enqueueing would return 202 and leave them guessing, since
     * NotificationDelivery has no UI to check. The send is bounded by the
     * notifier's own timeout, and nothing is written until Slack answers.
     */
    async test(organizationId, channelId, actor) {
      const channel = await prisma.alertChannel.findFirst({
        where: { id: channelId, organizationId, deletedAt: null },
        select: { id: true, type: true, name: true, config: true },
      });
      if (!channel) return null;

      if (!TESTABLE_TYPES.includes(channel.type)) {
        throw new AppError(
          "bad_request",
          `${channel.type} channels cannot deliver yet, so there is nothing to test. ` +
            `Only ${TESTABLE_TYPES.join(", ")} channels send real notifications in this build.`,
        );
      }

      const webhookUrl = await resolveSlackWebhookUrl(prisma, organizationId, channel.config).catch(
        (err: unknown) => {
          throw new AppError(
            "validation_failed",
            err instanceof Error ? err.message : "Invalid Slack channel configuration.",
          );
        },
      );

      const result = await SlackNotifier.send(
        webhookUrl,
        {
          event: "test",
          title: `Test alert from ${channel.name}`,
          summary: "If you can read this, this channel can page you. No incident was created.",
          timestamp: new Date().toISOString(),
        },
        { fetchImpl: deps.fetchImpl },
      );

      if (!result.ok) {
        // Surface what Slack actually said — "no_service" (revoked webhook) and
        // "invalid_payload" need very different fixes from the operator.
        throw new AppError(
          "bad_request",
          `Slack rejected the test message (HTTP ${result.status}): ${result.error ?? "unknown error"}`,
        );
      }

      const verifiedAt = new Date();
      await prisma.alertChannel.update({ where: { id: channelId }, data: { verifiedAt } });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "alert_channel.tested",
        resourceType: "alertChannel",
        resourceId: channelId,
      });

      return { ok: true, verifiedAt };
    },
  };
}
