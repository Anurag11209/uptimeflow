import { AppError, buildPage, type Page } from "@backend-uptime/shared";
import type { Prisma, PrismaClient, RotationType } from "@backend-uptime/db";
import { whoIsOnCall } from "@backend-uptime/monitoring";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface UpsertScheduleInput {
  name: string;
  timezone: string;
  rotationType: RotationType;
  handoffMinute: number;
  /** Ordered participant user ids (rotation order). */
  participants: string[];
}

export interface OverrideInput {
  userId: string;
  startsAt: Date;
  endsAt: Date;
  reason?: string | null;
}

export interface ScheduleListItem {
  id: string;
  name: string;
  timezone: string;
  rotationType: RotationType;
  handoffMinute: number;
  participantCount: number;
  createdAt: Date;
}

export interface ScheduleDetail extends ScheduleListItem {
  participants: Array<{ userId: string; position: number; name: string | null; email: string | null }>;
}

export interface OnCallView {
  scheduleId: string;
  source: "override" | "rotation" | "empty";
  primary: { userId: string; name: string | null; email: string | null } | null;
  secondary: { userId: string; name: string | null; email: string | null } | null;
}

export interface OverrideView {
  id: string;
  userId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  createdAt: Date;
}

export interface Actor {
  userId: string | null;
  actorType: "user" | "api_key";
}

export interface OnCallScheduleService {
  list(organizationId: string, query: { limit: number; cursor?: string }): Promise<Page<ScheduleListItem>>;
  get(organizationId: string, id: string): Promise<ScheduleDetail | null>;
  create(organizationId: string, input: UpsertScheduleInput, actor: Actor): Promise<ScheduleDetail>;
  update(organizationId: string, id: string, input: UpsertScheduleInput, actor: Actor): Promise<ScheduleDetail | null>;
  remove(organizationId: string, id: string, actor: Actor): Promise<boolean>;
  whoIsOnCall(organizationId: string, id: string, now?: Date): Promise<OnCallView | null>;
  addOverride(organizationId: string, id: string, input: OverrideInput, actor: Actor): Promise<OverrideView | null>;
  listOverrides(organizationId: string, id: string): Promise<OverrideView[] | null>;
  removeOverride(organizationId: string, id: string, overrideId: string, actor: Actor): Promise<boolean>;
}

const DETAIL_INCLUDE = {
  participants: { orderBy: { position: "asc" }, include: { user: { select: { name: true, email: true } } } },
} satisfies Prisma.OnCallScheduleInclude;

type ScheduleRow = Prisma.OnCallScheduleGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toDetail(row: ScheduleRow): ScheduleDetail {
  return {
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    rotationType: row.rotationType,
    handoffMinute: row.handoffMinute,
    participantCount: row.participants.length,
    createdAt: row.createdAt,
    participants: row.participants.map((p) => ({
      userId: p.userId,
      position: p.position,
      name: p.user?.name ?? null,
      email: p.user?.email ?? null,
    })),
  };
}

function assertValidTimezone(tz: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new AppError("bad_request", `Invalid IANA timezone: ${tz}.`);
  }
}

/**
 * On-call schedule management (rotation participants, timezone, overrides) plus
 * "who is on call" resolution. Participants and override users are validated as
 * org members; every read/write is organization-scoped, and mutations audited.
 */
export function createOnCallScheduleService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}): OnCallScheduleService {
  const { prisma, auditLogs } = deps;

  async function assertMembers(organizationId: string, userIds: string[]): Promise<void> {
    for (const userId of new Set(userIds)) {
      const member = await prisma.member.findFirst({ where: { organizationId, userId }, select: { id: true } });
      if (!member) throw new AppError("bad_request", `User ${userId} is not a member of this org.`);
    }
  }

  async function loadOrgSchedule(organizationId: string, id: string): Promise<{ id: string } | null> {
    return prisma.onCallSchedule.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } });
  }

  async function enrichUser(userId: string | null): Promise<OnCallView["primary"]> {
    if (!userId) return null;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } });
    return { userId, name: user?.name ?? null, email: user?.email ?? null };
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.OnCallScheduleWhereInput[] = [{ organizationId, deletedAt: null }];
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.onCallSchedule.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: {
          id: true,
          name: true,
          timezone: true,
          rotationType: true,
          handoffMinute: true,
          createdAt: true,
          _count: { select: { participants: true } },
        },
      });

      return buildPage(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          timezone: r.timezone,
          rotationType: r.rotationType,
          handoffMinute: r.handoffMinute,
          participantCount: r._count.participants,
          createdAt: r.createdAt,
        })),
        query.limit,
      );
    },

    async get(organizationId, id) {
      const row = await prisma.onCallSchedule.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: DETAIL_INCLUDE,
      });
      return row ? toDetail(row) : null;
    },

    async create(organizationId, input, actor) {
      assertValidTimezone(input.timezone);
      await assertMembers(organizationId, input.participants);
      const row = await prisma.onCallSchedule.create({
        data: {
          organizationId,
          name: input.name,
          timezone: input.timezone,
          rotationType: input.rotationType,
          handoffMinute: input.handoffMinute,
          createdById: actor.userId,
          participants: { create: input.participants.map((userId, position) => ({ userId, position })) },
        },
        include: DETAIL_INCLUDE,
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "oncall_schedule.created",
        resourceType: "onCallSchedule",
        resourceId: row.id,
      });
      return toDetail(row);
    },

    async update(organizationId, id, input, actor) {
      if (!(await loadOrgSchedule(organizationId, id))) return null;
      assertValidTimezone(input.timezone);
      await assertMembers(organizationId, input.participants);

      const row = await prisma.$transaction(async (tx) => {
        await tx.onCallParticipant.deleteMany({ where: { scheduleId: id } });
        return tx.onCallSchedule.update({
          where: { id },
          data: {
            name: input.name,
            timezone: input.timezone,
            rotationType: input.rotationType,
            handoffMinute: input.handoffMinute,
            updatedById: actor.userId,
            participants: { create: input.participants.map((userId, position) => ({ userId, position })) },
          },
          include: DETAIL_INCLUDE,
        });
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "oncall_schedule.updated",
        resourceType: "onCallSchedule",
        resourceId: id,
      });
      return toDetail(row);
    },

    async remove(organizationId, id, actor) {
      const result = await prisma.onCallSchedule.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
      if (result.count === 0) return false;
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "oncall_schedule.deleted",
        resourceType: "onCallSchedule",
        resourceId: id,
      });
      return true;
    },

    async whoIsOnCall(organizationId, id, now = new Date()) {
      if (!(await loadOrgSchedule(organizationId, id))) return null;
      const resolved = await whoIsOnCall(prisma, id, now);
      if (!resolved) return null;
      return {
        scheduleId: id,
        source: resolved.source,
        primary: await enrichUser(resolved.primaryUserId),
        secondary: await enrichUser(resolved.secondaryUserId),
      };
    },

    async addOverride(organizationId, id, input, actor) {
      if (!(await loadOrgSchedule(organizationId, id))) return null;
      await assertMembers(organizationId, [input.userId]);
      if (input.endsAt.getTime() <= input.startsAt.getTime()) {
        throw new AppError("bad_request", "Override endsAt must be after startsAt.");
      }
      const override = await prisma.onCallOverride.create({
        data: { scheduleId: id, userId: input.userId, startsAt: input.startsAt, endsAt: input.endsAt, reason: input.reason ?? null },
        select: { id: true, userId: true, startsAt: true, endsAt: true, reason: true, createdAt: true },
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "oncall_schedule.updated",
        resourceType: "onCallSchedule",
        resourceId: id,
        metadata: { override: override.id },
      });
      return override;
    },

    async listOverrides(organizationId, id) {
      if (!(await loadOrgSchedule(organizationId, id))) return null;
      return prisma.onCallOverride.findMany({
        where: { scheduleId: id },
        orderBy: { startsAt: "desc" },
        select: { id: true, userId: true, startsAt: true, endsAt: true, reason: true, createdAt: true },
      });
    },

    async removeOverride(organizationId, id, overrideId, actor) {
      if (!(await loadOrgSchedule(organizationId, id))) return false;
      const result = await prisma.onCallOverride.deleteMany({ where: { id: overrideId, scheduleId: id } });
      if (result.count === 0) return false;
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "oncall_schedule.updated",
        resourceType: "onCallSchedule",
        resourceId: id,
        metadata: { removedOverride: overrideId },
      });
      return true;
    },
  };
}
