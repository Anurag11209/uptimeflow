import { AppError, buildPage, encodeCursor, type Page } from "@backend-uptime/shared";
import { Prisma } from "@backend-uptime/db";
import type {
  AssertionComparator,
  AssertionSource,
  CheckStatus,
  HttpMethod,
  MonitorHealth,
  MonitorState,
  MonitorType,
  PrismaClient,
  ProbeRegion,
} from "@backend-uptime/db";
import { parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { PlanLimitsService } from "./plan-limits.service.js";

// ─── Input types ──────────────────────────────────────────────────────────────

export interface AssertionInput {
  source: AssertionSource;
  comparator: AssertionComparator;
  property?: string;
  expected: string;
}

export interface CreateMonitorInput {
  name: string;
  type: MonitorType;
  groupId?: string;
  // Target
  url?: string;
  host?: string;
  port?: number;
  httpMethod?: HttpMethod;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  expectedStatus?: number;
  keyword?: string;
  keywordInverted?: boolean;
  followRedirects?: boolean;
  verifySsl?: boolean;
  // Scheduling
  intervalSeconds?: number;
  timeoutSeconds?: number;
  retries?: number;
  regions?: ProbeRegion[];
  // Thresholds
  failureThreshold?: number;
  successThreshold?: number;
  // Routing
  escalationPolicyId?: string;
  // Nested (replace-all on update when provided)
  assertions?: AssertionInput[];
  channelIds?: string[];
}

export type UpdateMonitorInput = Partial<CreateMonitorInput>;

export interface MonitorActor {
  userId: string | null;
  actorType: "user" | "api_key";
}

// ─── Query types ──────────────────────────────────────────────────────────────

export interface MonitorListQuery {
  limit: number;
  cursor?: string;
  groupId?: string;
  health?: MonitorHealth;
  state?: MonitorState;
}

export interface CheckResultListQuery {
  limit: number;
  cursor?: string;
  region?: ProbeRegion;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export interface AssertionView {
  id: string;
  source: AssertionSource;
  comparator: AssertionComparator;
  property: string | null;
  expected: string;
}

export interface MonitorListItem {
  id: string;
  name: string;
  type: MonitorType;
  state: MonitorState;
  health: MonitorHealth;
  url: string | null;
  host: string | null;
  port: number | null;
  intervalSeconds: number;
  groupId: string | null;
  groupName: string | null;
  lastCheckedAt: Date | null;
  lastResponseMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  escalationPolicyId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MonitorDetail extends MonitorListItem {
  httpMethod: HttpMethod | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | null;
  expectedStatus: number | null;
  keyword: string | null;
  keywordInverted: boolean;
  followRedirects: boolean;
  verifySsl: boolean;
  timeoutSeconds: number;
  retries: number;
  regions: ProbeRegion[];
  failureThreshold: number;
  successThreshold: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  assertions: AssertionView[];
  boundChannelIds: string[];
}

export interface CheckResultItem {
  id: string;
  region: ProbeRegion;
  status: CheckStatus;
  statusCode: number | null;
  responseMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  checkedAt: Date;
}

export interface CheckResultPage {
  items: CheckResultItem[];
  nextCursor: string | null;
}

export interface MaintenanceWindowView {
  id: string;
  title: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  suppressAlerts: boolean;
  createdAt: Date;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface MonitorService {
  list(organizationId: string, query: MonitorListQuery): Promise<Page<MonitorListItem>>;
  get(organizationId: string, monitorId: string): Promise<MonitorDetail | null>;
  create(
    organizationId: string,
    input: CreateMonitorInput,
    actor: MonitorActor,
  ): Promise<MonitorDetail>;
  update(
    organizationId: string,
    monitorId: string,
    input: UpdateMonitorInput,
    actor: MonitorActor,
  ): Promise<MonitorDetail | null>;
  remove(organizationId: string, monitorId: string, actor: MonitorActor): Promise<boolean>;
  pause(
    organizationId: string,
    monitorId: string,
    actor: MonitorActor,
  ): Promise<MonitorDetail | null>;
  resume(
    organizationId: string,
    monitorId: string,
    actor: MonitorActor,
  ): Promise<MonitorDetail | null>;
  listCheckResults(
    organizationId: string,
    monitorId: string,
    query: CheckResultListQuery,
  ): Promise<CheckResultPage | null>;
  listMaintenanceWindows(
    organizationId: string,
    monitorId: string,
  ): Promise<MaintenanceWindowView[]>;
  setChannels(organizationId: string, monitorId: string, channelIds: string[]): Promise<string[]>;
}

// ─── Prisma select shapes ─────────────────────────────────────────────────────

const LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  state: true,
  health: true,
  url: true,
  host: true,
  port: true,
  intervalSeconds: true,
  groupId: true,
  group: { select: { name: true } },
  lastCheckedAt: true,
  lastResponseMs: true,
  lastStatusCode: true,
  lastError: true,
  escalationPolicyId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.MonitorSelect;

const DETAIL_SELECT = {
  id: true,
  name: true,
  type: true,
  state: true,
  health: true,
  url: true,
  host: true,
  port: true,
  intervalSeconds: true,
  groupId: true,
  group: { select: { name: true } },
  lastCheckedAt: true,
  lastResponseMs: true,
  lastStatusCode: true,
  lastError: true,
  escalationPolicyId: true,
  createdAt: true,
  updatedAt: true,
  httpMethod: true,
  requestHeaders: true,
  requestBody: true,
  expectedStatus: true,
  keyword: true,
  keywordInverted: true,
  followRedirects: true,
  verifySsl: true,
  timeoutSeconds: true,
  retries: true,
  regions: true,
  failureThreshold: true,
  successThreshold: true,
  consecutiveFailures: true,
  consecutiveSuccesses: true,
  assertions: {
    select: { id: true, source: true, comparator: true, property: true, expected: true },
    orderBy: { createdAt: "asc" as const },
  },
  channels: { select: { channelId: true } },
} satisfies Prisma.MonitorSelect;

type ListRow = Prisma.MonitorGetPayload<{ select: typeof LIST_SELECT }>;
type DetailRow = Prisma.MonitorGetPayload<{ select: typeof DETAIL_SELECT }>;

// ─── Row → DTO mappers ────────────────────────────────────────────────────────

function toListItem(row: ListRow): MonitorListItem {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    health: row.health,
    url: row.url,
    host: row.host,
    port: row.port,
    intervalSeconds: row.intervalSeconds,
    groupId: row.groupId,
    groupName: row.group?.name ?? null,
    lastCheckedAt: row.lastCheckedAt,
    lastResponseMs: row.lastResponseMs,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    escalationPolicyId: row.escalationPolicyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDetail(row: DetailRow): MonitorDetail {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    state: row.state,
    health: row.health,
    url: row.url,
    host: row.host,
    port: row.port,
    intervalSeconds: row.intervalSeconds,
    groupId: row.groupId,
    groupName: row.group?.name ?? null,
    lastCheckedAt: row.lastCheckedAt,
    lastResponseMs: row.lastResponseMs,
    lastStatusCode: row.lastStatusCode,
    lastError: row.lastError,
    escalationPolicyId: row.escalationPolicyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    httpMethod: row.httpMethod,
    requestHeaders: (row.requestHeaders as Record<string, string> | null) ?? null,
    requestBody: row.requestBody,
    expectedStatus: row.expectedStatus,
    keyword: row.keyword,
    keywordInverted: row.keywordInverted,
    followRedirects: row.followRedirects,
    verifySsl: row.verifySsl,
    timeoutSeconds: row.timeoutSeconds,
    retries: row.retries,
    regions: row.regions,
    failureThreshold: row.failureThreshold,
    successThreshold: row.successThreshold,
    consecutiveFailures: row.consecutiveFailures,
    consecutiveSuccesses: row.consecutiveSuccesses,
    assertions: row.assertions.map((a) => ({
      id: a.id,
      source: a.source,
      comparator: a.comparator,
      property: a.property,
      expected: a.expected,
    })),
    boundChannelIds: row.channels.map((c) => c.channelId),
  };
}

// ─── Target-field validation per monitor type ─────────────────────────────────

/**
 * After merging update input with the existing row, ensure the combined target
 * config is coherent for the monitor type. Throws a string error code that the
 * route translates to a 422.
 */
function validateTargetFields(
  type: MonitorType,
  fields: {
    url?: string | null;
    host?: string | null;
    port?: number | null;
  },
): void {
  switch (type) {
    case "HTTP":
    case "KEYWORD":
    case "SSL":
      if (!fields.url) throw new Error("URL_REQUIRED");
      break;
    case "TCP":
    case "PORT":
      if (!fields.host) throw new Error("HOST_REQUIRED");
      if (!fields.port) throw new Error("PORT_REQUIRED");
      break;
    case "PING":
      if (!fields.host) throw new Error("HOST_REQUIRED");
      break;
    case "HEARTBEAT":
      // Inbound ping — no outbound target needed.
      break;
    case "DNS":
    case "GRPC":
      throw new Error("UNSUPPORTED_TYPE");
  }
}

// ─── Ownership guard helpers ──────────────────────────────────────────────────

async function assertGroupOwned(
  prisma: PrismaClient,
  groupId: string,
  organizationId: string,
): Promise<void> {
  const count = await prisma.monitorGroup.count({
    where: { id: groupId, organizationId, deletedAt: null },
  });
  if (count === 0) throw new Error("INVALID_GROUP");
}

async function assertPolicyOwned(
  prisma: PrismaClient,
  policyId: string,
  organizationId: string,
): Promise<void> {
  const count = await prisma.escalationPolicy.count({
    where: { id: policyId, organizationId, deletedAt: null },
  });
  if (count === 0) throw new Error("INVALID_ESCALATION_POLICY");
}

async function assertChannelsOwned(
  prisma: PrismaClient,
  channelIds: string[],
  organizationId: string,
): Promise<void> {
  if (channelIds.length === 0) return;
  const count = await prisma.alertChannel.count({
    where: { id: { in: channelIds }, organizationId, deletedAt: null },
  });
  if (count !== channelIds.length) throw new Error("INVALID_CHANNEL");
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createMonitorService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
  planLimits: PlanLimitsService;
}): MonitorService {
  const { prisma, auditLogs, planLimits } = deps;

  async function loadDetail(
    organizationId: string,
    monitorId: string,
  ): Promise<MonitorDetail | null> {
    const row = await prisma.monitor.findFirst({
      where: { id: monitorId, organizationId, deletedAt: null },
      select: DETAIL_SELECT,
    });
    return row ? toDetail(row) : null;
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);

      const conditions: Prisma.MonitorWhereInput[] = [{ organizationId, deletedAt: null }];
      if (query.groupId) conditions.push({ groupId: query.groupId });
      if (query.health) conditions.push({ health: query.health });
      if (query.state) conditions.push({ state: query.state });
      if (cursor) {
        const ts = new Date(cursor.createdAt);
        conditions.push({
          OR: [{ createdAt: { lt: ts } }, { createdAt: ts, id: { lt: cursor.id } }],
        });
      }

      const rows = await prisma.monitor.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: LIST_SELECT,
      });

      return buildPage(rows.map(toListItem), query.limit);
    },

    get: (organizationId, monitorId) => loadDetail(organizationId, monitorId),

    async create(organizationId, input, actor) {
      // Plan gate — reject before touching the DB.
      await planLimits.assertWithinLimit(organizationId, "monitor");

      // Target-field validation for the type.
      validateTargetFields(input.type, {
        url: input.url,
        host: input.host,
        port: input.port,
      });

      // Ownership guards for foreign-key-style references.
      if (input.groupId) await assertGroupOwned(prisma, input.groupId, organizationId);
      if (input.escalationPolicyId) {
        await assertPolicyOwned(prisma, input.escalationPolicyId, organizationId);
      }
      if (input.channelIds?.length) {
        await assertChannelsOwned(prisma, input.channelIds, organizationId);
      }

      const monitor = await prisma.monitor.create({
        data: {
          organizationId,
          name: input.name,
          type: input.type,
          groupId: input.groupId ?? null,
          url: input.url ?? null,
          host: input.host ?? null,
          port: input.port ?? null,
          httpMethod: input.httpMethod ?? undefined,
          requestHeaders: (input.requestHeaders as Prisma.JsonObject | undefined) ?? undefined,
          requestBody: input.requestBody ?? null,
          expectedStatus: input.expectedStatus ?? undefined,
          keyword: input.keyword ?? null,
          keywordInverted: input.keywordInverted ?? false,
          followRedirects: input.followRedirects ?? true,
          verifySsl: input.verifySsl ?? true,
          intervalSeconds: input.intervalSeconds ?? 60,
          timeoutSeconds: input.timeoutSeconds ?? 30,
          retries: input.retries ?? 2,
          regions: input.regions ?? [],
          failureThreshold: input.failureThreshold ?? 1,
          successThreshold: input.successThreshold ?? 1,
          escalationPolicyId: input.escalationPolicyId ?? null,
          createdById: actor.userId ?? undefined,
          assertions: input.assertions?.length
            ? {
                create: input.assertions.map((a) => ({
                  source: a.source,
                  comparator: a.comparator,
                  property: a.property ?? null,
                  expected: a.expected,
                })),
              }
            : undefined,
          channels: input.channelIds?.length
            ? { create: input.channelIds.map((id) => ({ channelId: id })) }
            : undefined,
        },
        select: DETAIL_SELECT,
      });

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "monitor.created",
        resourceType: "monitor",
        resourceId: monitor.id,
      });

      return toDetail(monitor);
    },

    async update(organizationId, monitorId, input, actor) {
      // Load existing for merge-validation.
      const existing = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: {
          type: true,
          url: true,
          host: true,
          port: true,
          groupId: true,
          escalationPolicyId: true,
        },
      });
      if (!existing) return null;

      const type = input.type ?? existing.type;
      const url = "url" in input ? input.url : existing.url;
      const host = "host" in input ? input.host : existing.host;
      const port = "port" in input ? input.port : existing.port;

      validateTargetFields(type, { url, host, port });

      if (input.groupId) await assertGroupOwned(prisma, input.groupId, organizationId);
      if (input.escalationPolicyId) {
        await assertPolicyOwned(prisma, input.escalationPolicyId, organizationId);
      }
      if (input.channelIds?.length) {
        await assertChannelsOwned(prisma, input.channelIds, organizationId);
      }

      // Build the scalar update data.
      // UncheckedUpdateInput exposes raw FK scalar fields (groupId,
      // escalationPolicyId) directly instead of requiring relation connect syntax.
      const data: Prisma.MonitorUncheckedUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.type !== undefined) data.type = input.type;
      if ("groupId" in input) data.groupId = input.groupId ?? null;
      if ("url" in input) data.url = input.url ?? null;
      if ("host" in input) data.host = input.host ?? null;
      if ("port" in input) data.port = input.port ?? null;
      if (input.httpMethod !== undefined) data.httpMethod = input.httpMethod;
      // Nullable JSON: Prisma rejects plain `null`; Prisma.DbNull is the sentinel.
      if (input.requestHeaders !== undefined) {
        data.requestHeaders =
          input.requestHeaders == null
            ? Prisma.DbNull
            : (input.requestHeaders as Prisma.InputJsonValue);
      }
      if ("requestBody" in input) data.requestBody = input.requestBody ?? null;
      if (input.expectedStatus !== undefined) data.expectedStatus = input.expectedStatus;
      if ("keyword" in input) data.keyword = input.keyword ?? null;
      if (input.keywordInverted !== undefined) data.keywordInverted = input.keywordInverted;
      if (input.followRedirects !== undefined) data.followRedirects = input.followRedirects;
      if (input.verifySsl !== undefined) data.verifySsl = input.verifySsl;
      if (input.intervalSeconds !== undefined) data.intervalSeconds = input.intervalSeconds;
      if (input.timeoutSeconds !== undefined) data.timeoutSeconds = input.timeoutSeconds;
      if (input.retries !== undefined) data.retries = input.retries;
      if (input.regions !== undefined) data.regions = input.regions;
      if (input.failureThreshold !== undefined) data.failureThreshold = input.failureThreshold;
      if (input.successThreshold !== undefined) data.successThreshold = input.successThreshold;
      if ("escalationPolicyId" in input) data.escalationPolicyId = input.escalationPolicyId ?? null;
      data.updatedById = actor.userId ?? undefined;

      // Replace assertions if supplied.
      if (input.assertions !== undefined) {
        await prisma.monitorAssertion.deleteMany({ where: { monitorId } });
        if (input.assertions.length > 0) {
          await prisma.monitorAssertion.createMany({
            data: input.assertions.map((a) => ({
              monitorId,
              source: a.source,
              comparator: a.comparator,
              property: a.property ?? null,
              expected: a.expected,
            })),
          });
        }
      }

      // Replace channel bindings if supplied.
      if (input.channelIds !== undefined) {
        await prisma.monitorChannel.deleteMany({ where: { monitorId } });
        if (input.channelIds.length > 0) {
          await prisma.monitorChannel.createMany({
            data: input.channelIds.map((id) => ({ monitorId, channelId: id })),
            skipDuplicates: true,
          });
        }
      }

      await prisma.monitor.update({ where: { id: monitorId }, data });

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "monitor.updated",
        resourceType: "monitor",
        resourceId: monitorId,
      });

      return loadDetail(organizationId, monitorId);
    },

    async remove(organizationId, monitorId, actor) {
      const result = await prisma.monitor.updateMany({
        where: { id: monitorId, organizationId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId ?? undefined },
      });
      if (result.count === 0) return false;

      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "monitor.deleted",
        resourceType: "monitor",
        resourceId: monitorId,
      });
      return true;
    },

    async pause(organizationId, monitorId, actor) {
      const existing = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true, state: true },
      });
      if (!existing) return null;

      if (existing.state !== "PAUSED") {
        await prisma.monitor.update({
          where: { id: monitorId },
          data: { state: "PAUSED", health: "PAUSED", updatedById: actor.userId ?? undefined },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "monitor.paused",
          resourceType: "monitor",
          resourceId: monitorId,
        });
      }

      return loadDetail(organizationId, monitorId);
    },

    async resume(organizationId, monitorId, actor) {
      const existing = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true, state: true },
      });
      if (!existing) return null;

      if (existing.state !== "ACTIVE") {
        await prisma.monitor.update({
          where: { id: monitorId },
          data: {
            state: "ACTIVE",
            health: "PENDING",
            consecutiveFailures: 0,
            consecutiveSuccesses: 0,
            updatedById: actor.userId ?? undefined,
          },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "monitor.resumed",
          resourceType: "monitor",
          resourceId: monitorId,
        });
      }

      return loadDetail(organizationId, monitorId);
    },

    async listCheckResults(organizationId, monitorId, query) {
      // Verify the monitor belongs to this org before exposing check data.
      const monitor = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!monitor) return null;

      const cursor = parseCursor(query.cursor);

      const conditions: Prisma.CheckResultWhereInput[] = [{ monitorId, organizationId }];
      if (query.region) conditions.push({ region: query.region });
      if (cursor) {
        // We encode checkedAt into the cursor's `createdAt` field.
        const ts = new Date(cursor.createdAt);
        conditions.push({
          OR: [{ checkedAt: { lt: ts } }, { checkedAt: ts, id: { lt: cursor.id } }],
        });
      }

      const rows = await prisma.checkResult.findMany({
        where: { AND: conditions },
        orderBy: [{ checkedAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: {
          id: true,
          region: true,
          status: true,
          statusCode: true,
          responseMs: true,
          errorType: true,
          errorMessage: true,
          checkedAt: true,
        },
      });

      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];

      return {
        items,
        nextCursor:
          hasMore && last
            ? encodeCursor({ id: last.id, createdAt: last.checkedAt.toISOString() })
            : null,
      };
    },

    async listMaintenanceWindows(organizationId, monitorId) {
      // Verify the monitor belongs to this org first.
      const monitor = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!monitor) throw AppError.notFound("Monitor not found.");

      const windows = await prisma.maintenanceWindow.findMany({
        where: {
          organizationId,
          deletedAt: null,
          monitors: { some: { id: monitorId } },
        },
        orderBy: { startsAt: "desc" },
        select: {
          id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          suppressAlerts: true,
          createdAt: true,
        },
      });

      return windows;
    },

    async setChannels(organizationId, monitorId, channelIds) {
      const monitor = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!monitor) throw AppError.notFound("Monitor not found.");

      if (channelIds.length > 0) {
        await assertChannelsOwned(prisma, channelIds, organizationId);
      }

      await prisma.monitorChannel.deleteMany({ where: { monitorId } });

      if (channelIds.length > 0) {
        await prisma.monitorChannel.createMany({
          data: channelIds.map((id) => ({ monitorId, channelId: id })),
          skipDuplicates: true,
        });
      }

      return channelIds;
    },
  };
}
