import type { Job } from "bullmq";
import type { PrismaClient } from "@backend-uptime/db";
import type { AlertDispatcher } from "../alerting/dispatcher.js";
import { whoIsOnCall } from "../oncall/resolve.js";
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
  logger?: EscalationLogger;
}

export interface EscalationJobResult {
  incidentId: string;
  skipped?: "no_incident" | "stopped" | "no_policy" | "exhausted";
  stepFired?: number;
  responders?: string[];
  channelsPaged?: number;
  scheduledNext?: boolean;
  repeated?: number;
}

/**
 * Resolve a step's targets into the channels to page and the human responders to
 * record. SCHEDULE targets resolve to the currently on-call primary responder
 * (secondary is captured for the timeline). CHANNEL targets are dispatched
 * through the alert pipeline; USER targets are recorded for paging.
 */
async function executeStep(
  deps: EscalationProcessorDeps,
  ctx: { incidentId: string; organizationId: string },
  step: StepRow,
  now: Date,
): Promise<{ responders: string[]; channelsPaged: number; metadata: Record<string, unknown> }> {
  const channelIds: string[] = [];
  const responders: Array<{ userId: string; via: string; secondaryUserId?: string | null }> = [];

  for (const target of step.targets) {
    if (target.type === "CHANNEL" && target.channelId) {
      channelIds.push(target.channelId);
    } else if (target.type === "USER" && target.userId) {
      responders.push({ userId: target.userId, via: "user" });
    } else if (target.type === "SCHEDULE" && target.scheduleId) {
      const onCall = await whoIsOnCall(deps.prisma, target.scheduleId, now);
      if (onCall?.primaryUserId) {
        responders.push({
          userId: onCall.primaryUserId,
          via: `schedule:${onCall.source}`,
          secondaryUserId: onCall.secondaryUserId,
        });
      }
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

  const metadata = { step: step.position, responders, channelIds };
  await deps.prisma.incidentEvent.create({
    data: {
      incidentId: ctx.incidentId,
      type: "ESCALATED",
      message: `Escalation step ${step.position}: paged ${responders.length} responder(s) and ${channelsPaged} channel(s).`,
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

  return { responders: responders.map((r) => r.userId), channelsPaged, metadata };
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
      select: { status: true },
    });
    if (!incident) return { incidentId, skipped: "no_incident" };
    // Acknowledgement / resolution handling: a non-OPEN incident halts escalation.
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

    const fired = await executeStep(deps, { incidentId, organizationId }, step, now);

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
      channelsPaged: fired.channelsPaged,
      scheduledNext,
    };
  };
}
