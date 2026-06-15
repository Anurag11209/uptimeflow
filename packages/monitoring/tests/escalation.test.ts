import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import {
  createEscalationProcessor,
  createEscalationStarter,
  type EscalationJobData,
} from "../src/index.js";

type Target = { type: "USER" | "SCHEDULE" | "CHANNEL"; userId: string | null; scheduleId: string | null; channelId: string | null };
const channel = (id: string): Target => ({ type: "CHANNEL", channelId: id, userId: null, scheduleId: null });
const user = (id: string): Target => ({ type: "USER", userId: id, channelId: null, scheduleId: null });
const sched = (id: string): Target => ({ type: "SCHEDULE", scheduleId: id, userId: null, channelId: null });

function fakeQueue() {
  const adds: Array<{ data: EscalationJobData; opts?: { delay?: number } }> = [];
  return { adds, add: async (_n: string, data: EscalationJobData, opts?: { delay?: number }) => void adds.push({ data, opts }) };
}

const job = (over: Partial<EscalationJobData> = {}): Job<EscalationJobData> =>
  ({ data: { incidentId: "inc_1", organizationId: "org_1", monitorId: "mon_1", policyId: "pol_1", stepIndex: 0, round: 0, ...over } }) as Job<EscalationJobData>;

interface PrismaOpts {
  incidentStatus?: string;
  policy?: { repeatCount: number; steps: Array<{ position: number; delayMinutes: number; targets: Target[] }> } | null;
  schedule?: unknown;
}

function escPrisma(opts: PrismaOpts) {
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const prisma = {
    incident: { findUnique: async () => ({ status: opts.incidentStatus ?? "OPEN" }) },
    escalationPolicy: { findFirst: async () => opts.policy ?? null },
    onCallSchedule: { findFirst: async () => opts.schedule ?? null },
    incidentEvent: { create: async ({ data }: { data: Record<string, unknown> }) => void events.push(data) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void audits.push(data) },
  } as unknown as PrismaClient;
  return { prisma, events, audits };
}

const alerts = { dispatchToChannels: async (c: { channelIds: string[] }) => c.channelIds.length };

describe("escalation starter", () => {
  it("enqueues the first step after its delay", async () => {
    const queue = fakeQueue();
    const prisma = { escalationStep: { findFirst: async () => ({ delayMinutes: 0 }) } } as unknown as PrismaClient;
    const ok = await createEscalationStarter({ prisma, queue }).start({
      incidentId: "inc_1",
      organizationId: "org_1",
      monitorId: "mon_1",
      policyId: "pol_1",
    });
    expect(ok).toBe(true);
    expect(queue.adds[0]?.data).toMatchObject({ stepIndex: 0, round: 0 });
    expect(queue.adds[0]?.opts).toMatchObject({ delay: 0 });
  });

  it("returns false when the policy has no steps", async () => {
    const prisma = { escalationStep: { findFirst: async () => null } } as unknown as PrismaClient;
    const ok = await createEscalationStarter({ prisma, queue: fakeQueue() }).start({
      incidentId: "inc_1",
      organizationId: "org_1",
      monitorId: null,
      policyId: "pol_1",
    });
    expect(ok).toBe(false);
  });
});

describe("escalation processor", () => {
  it("fires a step, pages channels + users, and schedules the next step", async () => {
    const queue = fakeQueue();
    const { prisma, events, audits } = escPrisma({
      policy: {
        repeatCount: 0,
        steps: [
          { position: 0, delayMinutes: 0, targets: [channel("ch_1"), user("u1")] },
          { position: 1, delayMinutes: 5, targets: [channel("ch_2")] },
        ],
      },
    });
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job());
    expect(result).toMatchObject({ stepFired: 0, channelsPaged: 1, responders: ["u1"], scheduledNext: true });
    expect(queue.adds[0]?.data).toMatchObject({ stepIndex: 1 });
    expect(queue.adds[0]?.opts).toMatchObject({ delay: 5 * 60_000 });
    expect(events[0]).toMatchObject({ type: "ESCALATED" });
    expect(audits[0]).toMatchObject({ action: "incident.escalated" });
  });

  it("resolves a SCHEDULE target to the on-call primary", async () => {
    const queue = fakeQueue();
    const { prisma } = escPrisma({
      policy: { repeatCount: 0, steps: [{ position: 0, delayMinutes: 0, targets: [sched("sch_1")] }] },
      schedule: {
        timezone: "UTC",
        rotationType: "WEEKLY",
        handoffMinute: 540,
        participants: [
          { userId: "p1", position: 0 },
          { userId: "p2", position: 1 },
        ],
        overrides: [],
      },
    });
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job());
    expect(result.responders).toHaveLength(1);
    expect(["p1", "p2"]).toContain(result.responders![0]);
  });

  it("halts escalation when the incident is no longer OPEN (acknowledged)", async () => {
    const queue = fakeQueue();
    const { prisma, events } = escPrisma({ incidentStatus: "ACKNOWLEDGED", policy: { repeatCount: 0, steps: [] } });
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job());
    expect(result.skipped).toBe("stopped");
    expect(events).toHaveLength(0);
    expect(queue.adds).toHaveLength(0);
  });

  it("repeats the policy when rounds remain after the last step", async () => {
    const queue = fakeQueue();
    const { prisma } = escPrisma({
      policy: { repeatCount: 1, steps: [{ position: 0, delayMinutes: 0, targets: [channel("ch_1")] }] },
    });
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job({ stepIndex: 0, round: 0 }));
    expect(result.scheduledNext).toBe(true);
    expect(queue.adds[0]?.data).toMatchObject({ stepIndex: 0, round: 1 });
  });

  it("is exhausted past the last step with no rounds left", async () => {
    const queue = fakeQueue();
    const { prisma } = escPrisma({
      policy: { repeatCount: 0, steps: [{ position: 0, delayMinutes: 0, targets: [channel("ch_1")] }] },
    });
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job({ stepIndex: 1, round: 0 }));
    expect(result.skipped).toBe("exhausted");
    expect(queue.adds).toHaveLength(0);
  });
});
