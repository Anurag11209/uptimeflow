import type { Job } from "bullmq";
import type { PrismaClient } from "@backend-uptime/db";
import type { AlertDispatcher } from "../alerting/dispatcher.js";
import { whoIsOnCall } from "../oncall/resolve.js";
import type { ResponderNotifier } from "./notifier.js";
import { ESCALATION_JOB_NAME, type EscalationJobData } from "./queue.js";

export interface EscalationLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

/** Minimal queue surface the engine needs (real BullMQ Queue satisfies it). */
export interface EscalationEnqueuer {
  add(name: string, data: EscalationJobData, opts?: { delay?: number }): Promise<unknown>;
}

export interface EscalationContext {
  incidentId: string;
  organizationId: string;
  monitorId: string | null;
  policyId: string;
}

export interface EscalationStarter {
  /** Kick off escalation for a freshly opened incident. False if the policy has no steps. */
  start(ctx: EscalationContext): Promise<boolean>;
}

const minutesToMs = (m: number): number => Math.max(0, m) * 60_000;

/**
 * Enqueues the first escalation step (after its configured delay). Called by the
 * result pipeline when an incident opens for a monitor with an escalation policy.
 */
export function createEscalationStarter(deps: {
  prisma: PrismaClient;
  queue: EscalationEnqueuer;
  logger?: EscalationLogger;
}): EscalationStarter {
  return {
    async start(ctx) {
      const first = await deps.prisma.escalationStep.findFirst({
        where: { policyId: ctx.policyId },
        orderBy: { position: "asc" },
        select: { delayMinutes: true },
      });
      if (!first) return false;
      await deps.queue.add(
        ESCALATION_JOB_NAME,
        { ...ctx, stepIndex: 0, round: 0 },
        { delay: minutesToMs(first.delayMinutes) },
      );
      deps.logger?.info({ incidentId: ctx.incidentId, policyId: ctx.policyId }, "escalation started");
      return true;
    },
  };
}

interface StepRow {
  position: number;
  delayMinutes: number;
  targets: Array<{
    type: "USER" | "SCHEDULE" | "CHANNEL";
    userId: string | null;
    scheduleId: string | null;
    channelId: string | null;
  }>;
}

export interface EscalationProcessorDeps {
  prisma: PrismaClient;
  queue: EscalationEnqueuer;
  alerts: Pick<AlertDispatcher, "dispatchToChannels">;
  /**
   * Delivers pages to USER/SCHEDULE responders. Absent means those targets are
   * resolved and recorded but nobody is contacted — the pre-Phase-2 behaviour,
   * kept only so existing tests and any caller that has not wired a notifier
   * yet degrade visibly (the timeline says "0 paged") rather than silently.
   */
  responders?: ResponderNotifier;
  logger?: EscalationLogger;
}

/** Incident fields a page needs, loaded once per step. */
export interface EscalationIncidentContext {
  title: string;
  summary: string | null;
  severity: string | null;
  monitorName: string | null;
}

/** A type alias, not an interface: Prisma's InputJsonValue requires an implicit
 *  index signature, which interfaces do not get. */
type ResponderRef = {
  userId: string;
  via: string;
  secondaryUserId?: string | null;
};

export interface EscalationJobResult {
  incidentId: string;
  skipped?: "no_incident" | "stopped" | "no_policy" | "exhausted";
  stepFired?: number;
  responders?: string[];
  /** Responders an actual notification was delivered to. */
  respondersPaged?: number;
  /** Responders whose page failed (bad address, notifier error, unknown user). */
  respondersFailed?: number;
  channelsPaged?: number;
  scheduledNext?: boolean;
  repeated?: number;
}

/**
 * Resolve a step's targets and actually contact them.
 *
 * CHANNEL targets go through the Phase-1 alert transports. USER targets page
 * that person; SCHEDULE targets page whoever the on-call resolver says is
 * currently primary. Before Phase 2 the last two were collected into a list,
 * written to the timeline as "paged N responder(s)", and then dropped on the
 * floor — the timeline claimed a page that never happened.
 *
 * Paging is best-effort per responder: one unreachable address must not abort
 * the step and leave the rest of the rotation uncontacted, and must not throw,
 * because a BullMQ retry would re-page everyone who already succeeded. Failures
 * are counted and named in the timeline instead.
 */
async function executeStep(
  deps: EscalationProcessorDeps,
  ctx: { incidentId: string; organizationId: string; incident: EscalationIncidentContext },
  step: StepRow,
  now: Date,
): Promise<{
  responders: string[];
  respondersPaged: number;
  respondersFailed: number;
  channelsPaged: number;
  metadata: Record<string, unknown>;
}> {
  const channelIds: string[] = [];
  const responders: ResponderRef[] = [];
  /** A user targeted directly *and* on-call for a schedule in the same step is one person. */
  const seenUserIds = new Set<string>();

  function addResponder(ref: ResponderRef): void {
    if (seenUserIds.has(ref.userId)) return;
    seenUserIds.add(ref.userId);
    responders.push(ref);
  }

  for (const target of step.targets) {
    if (target.type === "CHANNEL" && target.channelId) {
      channelIds.push(target.channelId);
    } else if (target.type === "USER" && target.userId) {
      addResponder({ userId: target.userId, via: "user" });
    } else if (target.type === "SCHEDULE" && target.scheduleId) {
      const onCall = await whoIsOnCall(deps.prisma, target.scheduleId, now);
      if (onCall?.primaryUserId) {
        addResponder({
          userId: onCall.primaryUserId,
          via: `schedule:${onCall.source}`,
          // Secondary is recorded for the timeline but not paged — escalating
          // to the backup is what the next step is for.
          secondaryUserId: onCall.secondaryUserId,
        });
      }
    }
  }

  // ── Page the humans ───────────────────────────────────────────────────────
  const pagedUserIds: string[] = [];
  const failed: Array<{ userId: string; reason: string }> = [];

  if (responders.length > 0) {
    if (!deps.responders) {
      // No notifier wired: record honestly rather than implying a page.
      for (const r of responders) failed.push({ userId: r.userId, reason: "no responder notifier configured" });
    } else {
      const users = await deps.prisma.user.findMany({
        where: { id: { in: responders.map((r) => r.userId) } },
        select: { id: true, email: true, name: true },
      });
      const byId = new Map(users.map((u) => [u.id, u]));

      await Promise.all(
        responders.map(async (ref) => {
          const user = byId.get(ref.userId);
          if (!user?.email) {
            failed.push({ userId: ref.userId, reason: "user not found or has no email" });
            return;
          }
          try {
            await deps.responders!.page({
              incidentId: ctx.incidentId,
              organizationId: ctx.organizationId,
              userId: user.id,
              email: user.email,
              userName: user.name,
              via: ref.via,
              step: step.position,
              incidentTitle: ctx.incident.title,
              severity: ctx.incident.severity,
              summary: ctx.incident.summary,
              monitorName: ctx.incident.monitorName,
            });
            pagedUserIds.push(user.id);
          } catch (err) {
            failed.push({
              userId: ref.userId,
              reason: err instanceof Error ? err.message.slice(0, 200) : "page failed",
            });
          }
        }),
      );
    }
  }

  let channelsPaged = 0;
  if (channelIds.length > 0) {
    channelsPaged = await deps.alerts.dispatchToChannels({
      incidentId: ctx.incidentId,
      organizationId: ctx.organizationId,
      channelIds,
      kind: "opened",
    });
  }

  const metadata = {
    step: step.position,
    responders,
    channelIds,
    pagedUserIds,
    failedPages: failed,
  };
  // The message reports what actually happened, including failures — this line
  // is what an operator reads when asking "was I paged?".
  const failureNote = failed.length > 0 ? `, ${failed.length} page(s) failed` : "";
  await deps.prisma.incidentEvent.create({
    data: {
      incidentId: ctx.incidentId,
      type: "ESCALATED",
      message:
        `Escalation step ${step.position}: paged ${pagedUserIds.length} responder(s) ` +
        `and ${channelsPaged} channel(s)${failureNote}.`,
      metadata,
      createdAt: now,
    },
  });
  await deps.prisma.auditLog.create({
    data: {
      organizationId: ctx.organizationId,
      actorType: "system",
      action: "incident.escalated",
      resourceType: "incident",
      resourceId: ctx.incidentId,
      metadata,
    },
  });

  if (failed.length > 0) {
    deps.logger?.warn(
      { incidentId: ctx.incidentId, step: step.position, failed },
      "escalation could not page every responder",
    );
  }

  return {
    responders: responders.map((r) => r.userId),
    respondersPaged: pagedUserIds.length,
    respondersFailed: failed.length,
    channelsPaged,
    metadata,
  };
}

/**
 * Escalation worker. Each job fires one step:
 *   • stops immediately if the incident is no longer OPEN (acknowledgement /
 *     resolution handling — no job cancellation needed),
 *   • pages the step's targets,
 *   • schedules the next step after its delay, or repeats the policy up to
 *     `repeatCount`, then stops.
 */
export function createEscalationProcessor(deps: EscalationProcessorDeps) {
  return async (job: Job<EscalationJobData>): Promise<EscalationJobResult> => {
    const { incidentId, organizationId, policyId, stepIndex, round } = job.data;
    const now = new Date();

    const incident = await deps.prisma.incident.findUnique({
      where: { id: incidentId },
      select: {
        status: true,
        title: true,
        summary: true,
        severity: true,
        monitor: { select: { name: true } },
      },
    });
    if (!incident) return { incidentId, skipped: "no_incident" };
    // Acknowledgement / resolution handling. This is the guard that makes a
    // resolved or acknowledged incident stop paging people, and it runs before
    // the policy is even loaded: a delayed step that fires after the incident
    // closed reads one row, sends nothing, and — because it returns here —
    // queues no successor, so the rest of the chain dies with it. No job
    // cancellation is involved; state is the single source of truth.
    if (incident.status !== "OPEN") {
      deps.logger?.info({ incidentId, status: incident.status }, "escalation halted");
      return { incidentId, skipped: "stopped" };
    }

    const policy = await deps.prisma.escalationPolicy.findFirst({
      where: { id: policyId, deletedAt: null },
      select: {
        repeatCount: true,
        steps: {
          orderBy: { position: "asc" },
          select: {
            position: true,
            delayMinutes: true,
            targets: { select: { type: true, userId: true, scheduleId: true, channelId: true } },
          },
        },
      },
    });
    if (!policy || policy.steps.length === 0) return { incidentId, skipped: "no_policy" };

    const steps = policy.steps as StepRow[];
    const step = steps[stepIndex];
    if (!step) {
      // Past the last step: repeat the whole policy if rounds remain.
      if (round < policy.repeatCount) {
        await deps.queue.add(
          ESCALATION_JOB_NAME,
          { ...job.data, stepIndex: 0, round: round + 1 },
          { delay: minutesToMs(steps[0]!.delayMinutes) },
        );
        return { incidentId, repeated: round + 1 };
      }
      return { incidentId, skipped: "exhausted" };
    }

    const fired = await executeStep(
      deps,
      {
        incidentId,
        organizationId,
        incident: {
          title: incident.title,
          summary: incident.summary,
          severity: incident.severity,
          monitorName: incident.monitor?.name ?? null,
        },
      },
      step,
      now,
    );

    let scheduledNext = false;
    const next = steps[stepIndex + 1];
    if (next) {
      await deps.queue.add(
        ESCALATION_JOB_NAME,
        { ...job.data, stepIndex: stepIndex + 1 },
        { delay: minutesToMs(next.delayMinutes) },
      );
      scheduledNext = true;
    } else if (round < policy.repeatCount) {
      await deps.queue.add(
        ESCALATION_JOB_NAME,
        { ...job.data, stepIndex: 0, round: round + 1 },
        { delay: minutesToMs(steps[0]!.delayMinutes) },
      );
      scheduledNext = true;
    }

    return {
      incidentId,
      stepFired: step.position,
      responders: fired.responders,
      respondersPaged: fired.respondersPaged,
      respondersFailed: fired.respondersFailed,
      channelsPaged: fired.channelsPaged,
      scheduledNext,
    };
  };
}
