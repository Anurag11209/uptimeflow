import { AppError, buildPage, type Page } from "@backend-uptime/shared";
import type { Prisma, PrismaClient } from "@backend-uptime/db";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

export type EscalationTargetType = "USER" | "SCHEDULE" | "CHANNEL";

export interface EscalationTargetInput {
  type: EscalationTargetType;
  userId?: string;
  scheduleId?: string;
  channelId?: string;
}

export interface EscalationStepInput {
  delayMinutes: number;
  targets: EscalationTargetInput[];
}

export interface UpsertEscalationPolicyInput {
  name: string;
  description?: string | null;
  repeatCount?: number;
  steps: EscalationStepInput[];
}

export interface EscalationPolicyListItem {
  id: string;
  name: string;
  description: string | null;
  repeatCount: number;
  stepCount: number;
  createdAt: Date;
}

export interface EscalationPolicyDetail extends EscalationPolicyListItem {
  steps: Array<{
    id: string;
    position: number;
    delayMinutes: number;
    targets: Array<{ id: string; type: EscalationTargetType; userId: string | null; scheduleId: string | null; channelId: string | null }>;
  }>;
}

export interface Actor {
  userId: string | null;
  actorType: "user" | "api_key";
}

export interface EscalationPolicyService {
  list(organizationId: string, query: { limit: number; cursor?: string }): Promise<Page<EscalationPolicyListItem>>;
  get(organizationId: string, id: string): Promise<EscalationPolicyDetail | null>;
  create(organizationId: string, input: UpsertEscalationPolicyInput, actor: Actor): Promise<EscalationPolicyDetail>;
  update(organizationId: string, id: string, input: UpsertEscalationPolicyInput, actor: Actor): Promise<EscalationPolicyDetail | null>;
  remove(organizationId: string, id: string, actor: Actor): Promise<boolean>;
}

const DETAIL_INCLUDE = {
  steps: {
    orderBy: { position: "asc" },
    include: { targets: true },
  },
} satisfies Prisma.EscalationPolicyInclude;

type PolicyRow = Prisma.EscalationPolicyGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toDetail(row: PolicyRow): EscalationPolicyDetail {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    repeatCount: row.repeatCount,
    stepCount: row.steps.length,
    createdAt: row.createdAt,
    steps: row.steps.map((s) => ({
      id: s.id,
      position: s.position,
      delayMinutes: s.delayMinutes,
      targets: s.targets.map((t) => ({
        id: t.id,
        type: t.type,
        userId: t.userId,
        scheduleId: t.scheduleId,
        channelId: t.channelId,
      })),
    })),
  };
}

/**
 * Multi-step escalation policy management. Steps are ordered and each carries a
 * delay; targets reference org members, on-call schedules, or alert channels —
 * all validated to belong to the same organization (tenant isolation). Mutations
 * are audited.
 */
export function createEscalationPolicyService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}): EscalationPolicyService {
  const { prisma, auditLogs } = deps;

  /** Reject any target that references an entity outside this organization. */
  async function validateTargets(organizationId: string, steps: EscalationStepInput[]): Promise<void> {
    for (const step of steps) {
      for (const target of step.targets) {
        if (target.type === "USER") {
          if (!target.userId) throw new AppError("bad_request", "USER target requires userId.");
          const member = await prisma.member.findFirst({
            where: { organizationId, userId: target.userId },
            select: { id: true },
          });
          if (!member) throw new AppError("bad_request", `User ${target.userId} is not a member of this org.`);
        } else if (target.type === "SCHEDULE") {
          if (!target.scheduleId) throw new AppError("bad_request", "SCHEDULE target requires scheduleId.");
          const schedule = await prisma.onCallSchedule.findFirst({
            where: { id: target.scheduleId, organizationId, deletedAt: null },
            select: { id: true },
          });
          if (!schedule) throw new AppError("bad_request", `Schedule ${target.scheduleId} not found in this org.`);
        } else {
          if (!target.channelId) throw new AppError("bad_request", "CHANNEL target requires channelId.");
          const channel = await prisma.alertChannel.findFirst({
            where: { id: target.channelId, organizationId, deletedAt: null },
            select: { id: true },
          });
          if (!channel) throw new AppError("bad_request", `Channel ${target.channelId} not found in this org.`);
        }
      }
    }
  }

  function stepCreates(steps: EscalationStepInput[]): Prisma.EscalationStepCreateWithoutPolicyInput[] {
    return steps.map((step, index) => ({
      position: index,
      delayMinutes: step.delayMinutes,
      targets: {
        create: step.targets.map((t) => ({
          type: t.type,
          userId: t.userId ?? null,
          scheduleId: t.scheduleId ?? null,
          channelId: t.channelId ?? null,
        })),
      },
    }));
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.EscalationPolicyWhereInput[] = [{ organizationId, deletedAt: null }];
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.escalationPolicy.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: { id: true, name: true, description: true, repeatCount: true, createdAt: true, _count: { select: { steps: true } } },
      });

      return buildPage(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          repeatCount: r.repeatCount,
          stepCount: r._count.steps,
          createdAt: r.createdAt,
        })),
        query.limit,
      );
    },

    async get(organizationId, id) {
      const row = await prisma.escalationPolicy.findFirst({
        where: { id, organizationId, deletedAt: null },
        include: DETAIL_INCLUDE,
      });
      return row ? toDetail(row) : null;
    },

    async create(organizationId, input, actor) {
      await validateTargets(organizationId, input.steps);
      const row = await prisma.escalationPolicy.create({
        data: {
          organizationId,
          name: input.name,
          description: input.description ?? null,
          repeatCount: input.repeatCount ?? 0,
          createdById: actor.userId,
          steps: { create: stepCreates(input.steps) },
        },
        include: DETAIL_INCLUDE,
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "escalation_policy.created",
        resourceType: "escalationPolicy",
        resourceId: row.id,
      });
      return toDetail(row);
    },

    async update(organizationId, id, input, actor) {
      const existing = await prisma.escalationPolicy.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return null;
      await validateTargets(organizationId, input.steps);

      // Replace steps wholesale (cascade removes their targets) in one tx.
      const row = await prisma.$transaction(async (tx) => {
        await tx.escalationStep.deleteMany({ where: { policyId: id } });
        return tx.escalationPolicy.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description ?? null,
            repeatCount: input.repeatCount ?? 0,
            updatedById: actor.userId,
            steps: { create: stepCreates(input.steps) },
          },
          include: DETAIL_INCLUDE,
        });
      });
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "escalation_policy.updated",
        resourceType: "escalationPolicy",
        resourceId: id,
      });
      return toDetail(row);
    },

    async remove(organizationId, id, actor) {
      const result = await prisma.escalationPolicy.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
      if (result.count === 0) return false;
      await auditLogs.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "escalation_policy.deleted",
        resourceType: "escalationPolicy",
        resourceId: id,
      });
      return true;
    },
  };
}
