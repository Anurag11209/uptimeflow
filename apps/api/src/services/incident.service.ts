import type { IncidentStatus, Prisma, PrismaClient } from "@backend-uptime/db";
import { buildPage, type Page } from "@backend-uptime/shared";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface IncidentListItem {
  id: string;
  status: IncidentStatus;
  severity: string;
  title: string;
  summary: string | null;
  monitorId: string | null;
  monitorName: string | null;
  startedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  durationSec: number | null;
  createdAt: Date;
}

export interface IncidentTimelineEvent {
  id: string;
  type: string;
  message: string | null;
  actorId: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface IncidentDetail extends IncidentListItem {
  cause: string | null;
  acknowledgedById: string | null;
  events: IncidentTimelineEvent[];
}

export interface IncidentListQuery {
  status?: IncidentStatus;
  monitorId?: string;
  limit: number;
  cursor?: string;
}

export interface IncidentActor {
  userId: string | null;
  actorType: "user" | "api_key";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface IncidentService {
  list(organizationId: string, query: IncidentListQuery): Promise<Page<IncidentListItem>>;
  get(organizationId: string, incidentId: string): Promise<IncidentDetail | null>;
  acknowledge(organizationId: string, incidentId: string, actor: IncidentActor): Promise<IncidentDetail | null>;
  resolve(organizationId: string, incidentId: string, actor: IncidentActor): Promise<IncidentDetail | null>;
  comment(
    organizationId: string,
    incidentId: string,
    message: string,
    actor: IncidentActor,
  ): Promise<IncidentTimelineEvent | null>;
}

const LIST_SELECT = {
  id: true,
  status: true,
  severity: true,
  title: true,
  summary: true,
  monitorId: true,
  startedAt: true,
  acknowledgedAt: true,
  resolvedAt: true,
  durationSec: true,
  createdAt: true,
  monitor: { select: { name: true } },
} satisfies Prisma.IncidentSelect;

type IncidentRow = Prisma.IncidentGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: IncidentRow): IncidentListItem {
  return {
    id: row.id,
    status: row.status,
    severity: row.severity,
    title: row.title,
    summary: row.summary,
    monitorId: row.monitorId,
    monitorName: row.monitor?.name ?? null,
    startedAt: row.startedAt,
    acknowledgedAt: row.acknowledgedAt,
    resolvedAt: row.resolvedAt,
    durationSec: row.durationSec,
    createdAt: row.createdAt,
  };
}

/**
 * Human-facing incident management (list / timeline / acknowledge / resolve /
 * comment). The automated open/resolve-from-checks path lives in the monitoring
 * pipeline; both operate on the same Incident/IncidentEvent tables. Every query
 * is scoped by organizationId for tenant isolation, and every mutation appends a
 * timeline event plus an audit entry.
 */
export function createIncidentService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}): IncidentService {
  const { prisma, auditLogs } = deps;

  async function loadDetail(organizationId: string, incidentId: string): Promise<IncidentDetail | null> {
    const row = await prisma.incident.findFirst({
      where: { id: incidentId, organizationId },
      select: {
        ...LIST_SELECT,
        cause: true,
        acknowledgedById: true,
        events: {
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true, message: true, actorId: true, metadata: true, createdAt: true },
        },
      },
    });
    if (!row) return null;
    return {
      ...toListItem(row),
      cause: row.cause,
      acknowledgedById: row.acknowledgedById,
      events: row.events.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        actorId: e.actorId,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
    };
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.IncidentWhereInput[] = [{ organizationId }];
      if (query.status) conditions.push({ status: query.status });
      if (query.monitorId) conditions.push({ monitorId: query.monitorId });
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.incident.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: LIST_SELECT,
      });

      return buildPage(rows.map(toListItem), query.limit);
    },

    get: (organizationId, incidentId) => loadDetail(organizationId, incidentId),

    async acknowledge(organizationId, incidentId, actor) {
      const existing = await prisma.incident.findFirst({
        where: { id: incidentId, organizationId },
        select: { id: true, status: true },
      });
      if (!existing) return null;

      if (existing.status === "OPEN") {
        await prisma.incident.update({
          where: { id: incidentId },
          data: {
            status: "ACKNOWLEDGED",
            acknowledgedAt: new Date(),
            acknowledgedById: actor.userId,
            events: { create: { type: "ACKNOWLEDGED", message: "Acknowledged.", actorId: actor.userId } },
          },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "incident.acknowledged",
          resourceType: "incident",
          resourceId: incidentId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      }
      return loadDetail(organizationId, incidentId);
    },

    async resolve(organizationId, incidentId, actor) {
      const existing = await prisma.incident.findFirst({
        where: { id: incidentId, organizationId },
        select: { id: true, status: true, startedAt: true },
      });
      if (!existing) return null;

      if (existing.status !== "RESOLVED") {
        const now = new Date();
        const durationSec = Math.max(0, Math.round((now.getTime() - existing.startedAt.getTime()) / 1000));
        await prisma.incident.update({
          where: { id: incidentId },
          data: {
            status: "RESOLVED",
            resolvedAt: now,
            durationSec,
            // Free the dedupe key so the monitor can open a fresh incident later.
            fingerprint: null,
            events: { create: { type: "RESOLVED", message: "Resolved manually.", actorId: actor.userId } },
          },
        });
        await auditLogs.log({
          organizationId,
          actorId: actor.userId,
          actorType: actor.actorType,
          action: "incident.resolved",
          resourceType: "incident",
          resourceId: incidentId,
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        });
      }
      return loadDetail(organizationId, incidentId);
    },

    async comment(organizationId, incidentId, message, actor) {
      const existing = await prisma.incident.findFirst({
        where: { id: incidentId, organizationId },
        select: { id: true },
      });
      if (!existing) return null;

      const event = await prisma.incidentEvent.create({
        data: { incidentId, type: "COMMENT", message, actorId: actor.userId },
        select: { id: true, type: true, message: true, actorId: true, metadata: true, createdAt: true },
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "incident.commented",
        resourceType: "incident",
        resourceId: incidentId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return event;
    },
  };
}
