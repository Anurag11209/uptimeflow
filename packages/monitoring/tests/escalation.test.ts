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
  /** null models an incident that no longer exists. */
  incident?: null;
  policy?: { repeatCount: number; steps: Array<{ position: number; delayMinutes: number; targets: Target[] }> } | null;
  schedule?: unknown;
  users?: Array<{ id: string; email: string; name: string }>;
}

function escPrisma(opts: PrismaOpts) {
  const events: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const users = opts.users ?? [];
  const prisma = {
    incident: {
      findUnique: async () =>
        opts.incident === null
          ? null
          : {
              status: opts.incidentStatus ?? "OPEN",
              title: "Acme API is down",
              summary: "connect ECONNREFUSED",
              severity: "MAJOR",
              monitor: { name: "Acme API" },
            },
    },
    escalationPolicy: { findFirst: async () => opts.policy ?? null },
    onCallSchedule: { findFirst: async () => opts.schedule ?? null },
    user: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        users.filter((u) => where.id.in.includes(u.id)),
    },
    incidentEvent: { create: async ({ data }: { data: Record<string, unknown> }) => void events.push(data) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => void audits.push(data) },
  } as unknown as PrismaClient;
  return { prisma, events, audits };
}

/** Records every page the engine attempts. */
function fakeResponders(behaviour: { failFor?: string[] } = {}) {
  const paged: Array<{ userId: string; email: string; via: string; step: number; incidentTitle: string }> = [];
  const notifier = {
    async page(n: {
      userId: string;
      email: string;
      via: string;
      step: number;
      incidentTitle: string;
    }): Promise<void> {
      if (behaviour.failFor?.includes(n.userId)) throw new Error(`mailbox full for ${n.userId}`);
      paged.push(n);
    },
  };
  return { notifier, paged };
}

const ALICE = { id: "u_alice", email: "alice@example.com", name: "Alice" };
const BOB = { id: "u_bob", email: "bob@example.com", name: "Bob" };

const oneStep = (targets: Target[], delayMinutes = 0) => ({
  repeatCount: 0,
  steps: [{ position: 1, delayMinutes, targets }],
});

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

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: escalation pages real humans
// ═══════════════════════════════════════════════════════════════════════════

// The failure mode that matters most: a delayed step that fires AFTER the
// incident is already resolved or acknowledged must not page anyone, and must
// not queue the rest of the chain. This is guaranteed by the state check at the
// top of the processor, not by cancelling queued jobs — so it holds even for a
// job that was scheduled hours earlier and is impossible to recall.
describe("a step firing after the incident closed", () => {
  it.each(["RESOLVED", "ACKNOWLEDGED"])("pages nobody when the incident is %s", async (status) => {
    const { prisma, events } = escPrisma({
      incidentStatus: status,
      policy: { repeatCount: 2, steps: [
        { position: 1, delayMinutes: 0, targets: [user(ALICE.id)] },
        { position: 2, delayMinutes: 5, targets: [user(BOB.id)] },
      ] },
      users: [ALICE, BOB],
    });
    const queue = fakeQueue();
    const { notifier, paged } = fakeResponders();

    const result = await createEscalationProcessor({
      prisma, queue, alerts, responders: notifier,
    })(job());

    expect(result.skipped).toBe("stopped");
    expect(paged).toHaveLength(0);           // nobody contacted
    expect(queue.adds).toHaveLength(0);      // chain dies — no next step, no repeat
    expect(events).toHaveLength(0);          // no misleading "escalated" entry
  });

  it("pages nobody when the incident no longer exists", async () => {
    const { prisma } = escPrisma({ incident: null, policy: oneStep([user(ALICE.id)]), users: [ALICE] });
    const queue = fakeQueue();
    const { notifier, paged } = fakeResponders();

    const result = await createEscalationProcessor({ prisma, queue, alerts, responders: notifier })(job());

    expect(result.skipped).toBe("no_incident");
    expect(paged).toHaveLength(0);
    expect(queue.adds).toHaveLength(0);
  });

  it("halts before loading the policy, so a deleted policy is irrelevant", async () => {
    const { prisma } = escPrisma({ incidentStatus: "RESOLVED", policy: null, users: [ALICE] });
    const { notifier, paged } = fakeResponders();
    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());
    expect(result.skipped).toBe("stopped");   // not "no_policy"
    expect(paged).toHaveLength(0);
  });
});

describe("USER targets", () => {
  it("delivers a real page with the incident context", async () => {
    const { prisma } = escPrisma({ policy: oneStep([user(ALICE.id)]), users: [ALICE] });
    const { notifier, paged } = fakeResponders();

    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());

    expect(paged).toHaveLength(1);
    expect(paged[0]).toMatchObject({
      userId: ALICE.id, email: ALICE.email, via: "user", step: 1, incidentTitle: "Acme API is down",
    });
    expect(result.respondersPaged).toBe(1);
    expect(result.respondersFailed).toBe(0);
  });

  it("records the real paged count on the timeline, not the target count", async () => {
    const { prisma, events } = escPrisma({ policy: oneStep([user(ALICE.id), user(BOB.id)]), users: [ALICE, BOB] });
    const { notifier } = fakeResponders({ failFor: [BOB.id] });

    await createEscalationProcessor({ prisma, queue: fakeQueue(), alerts, responders: notifier })(job());

    expect(events[0]).toMatchObject({ type: "ESCALATED" });
    expect(events[0]!.message).toContain("paged 1 responder(s)");
    expect(events[0]!.message).toContain("1 page(s) failed");
  });

  it("does not claim a page when no notifier is wired", async () => {
    const { prisma, events } = escPrisma({ policy: oneStep([user(ALICE.id)]), users: [ALICE] });
    const result = await createEscalationProcessor({ prisma, queue: fakeQueue(), alerts })(job());
    expect(result.respondersPaged).toBe(0);
    expect(result.respondersFailed).toBe(1);
    expect(events[0]!.message).toContain("paged 0 responder(s)");
  });

  it("counts an unknown user as failed rather than paged", async () => {
    const { prisma } = escPrisma({ policy: oneStep([user("u_ghost")]), users: [ALICE] });
    const { notifier, paged } = fakeResponders();
    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());
    expect(paged).toHaveLength(0);
    expect(result.respondersFailed).toBe(1);
  });

  // One bad address must not stop the rest of the rotation being paged, and
  // must not throw — a BullMQ retry would re-page whoever already succeeded.
  it("pages the rest of the step when one page fails, without throwing", async () => {
    const { prisma } = escPrisma({ policy: oneStep([user(ALICE.id), user(BOB.id)]), users: [ALICE, BOB] });
    const { notifier, paged } = fakeResponders({ failFor: [ALICE.id] });

    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());

    expect(paged.map((p) => p.userId)).toEqual([BOB.id]);
    expect(result.respondersPaged).toBe(1);
    expect(result.respondersFailed).toBe(1);
  });
});

describe("SCHEDULE targets", () => {
  const schedule = {
    timezone: "UTC", rotationType: "WEEKLY", handoffMinute: 0,
    participants: [{ userId: ALICE.id, position: 0 }, { userId: BOB.id, position: 1 }],
    overrides: [],
  };

  it("pages whoever the on-call resolver says is primary", async () => {
    const { prisma } = escPrisma({ policy: oneStep([sched("sch_1")]), schedule, users: [ALICE, BOB] });
    const { notifier, paged } = fakeResponders();

    await createEscalationProcessor({ prisma, queue: fakeQueue(), alerts, responders: notifier })(job());

    expect(paged).toHaveLength(1);
    expect(paged[0]!.via).toMatch(/^schedule:/);
    expect([ALICE.id, BOB.id]).toContain(paged[0]!.userId);
  });

  it("pages an active override holder instead of the rotation", async () => {
    const now = new Date();
    const { prisma } = escPrisma({
      policy: oneStep([sched("sch_1")]),
      schedule: {
        ...schedule,
        overrides: [{ userId: BOB.id, startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 3_600_000) }],
      },
      users: [ALICE, BOB],
    });
    const { notifier, paged } = fakeResponders();

    await createEscalationProcessor({ prisma, queue: fakeQueue(), alerts, responders: notifier })(job());

    expect(paged[0]).toMatchObject({ userId: BOB.id, via: "schedule:override" });
  });

  it("pages nobody when the schedule has no participants", async () => {
    const { prisma } = escPrisma({
      policy: oneStep([sched("sch_1")]),
      schedule: { ...schedule, participants: [], overrides: [] },
      users: [ALICE],
    });
    const { notifier, paged } = fakeResponders();
    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());
    expect(paged).toHaveLength(0);
    expect(result.respondersPaged).toBe(0);
  });

  // Someone named directly AND on-call for a schedule in the same step is one
  // person — they should get one page, not two.
  it("deduplicates a responder reached by two targets in one step", async () => {
    const { prisma } = escPrisma({
      policy: oneStep([user(ALICE.id), sched("sch_1")]),
      schedule: { ...schedule, participants: [{ userId: ALICE.id, position: 0 }], overrides: [] },
      users: [ALICE],
    });
    const { notifier, paged } = fakeResponders();

    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());

    expect(paged).toHaveLength(1);
    expect(result.respondersPaged).toBe(1);
  });
});

describe("step delays and repeats", () => {
  it("schedules the next step after that step's delay", async () => {
    const { prisma } = escPrisma({
      policy: { repeatCount: 0, steps: [
        { position: 1, delayMinutes: 0, targets: [user(ALICE.id)] },
        { position: 2, delayMinutes: 15, targets: [user(BOB.id)] },
      ] },
      users: [ALICE, BOB],
    });
    const queue = fakeQueue();
    const { notifier } = fakeResponders();

    await createEscalationProcessor({ prisma, queue, alerts, responders: notifier })(job());

    expect(queue.adds).toHaveLength(1);
    expect(queue.adds[0]!.data).toMatchObject({ stepIndex: 1 });
    expect(queue.adds[0]!.opts).toMatchObject({ delay: 15 * 60_000 });
  });

  it("repeats the policy from step 0 after the last step, honouring repeatCount", async () => {
    const { prisma } = escPrisma({
      policy: { repeatCount: 1, steps: [{ position: 1, delayMinutes: 10, targets: [user(ALICE.id)] }] },
      users: [ALICE],
    });
    const queue = fakeQueue();
    const { notifier } = fakeResponders();

    await createEscalationProcessor({ prisma, queue, alerts, responders: notifier })(job());

    expect(queue.adds[0]!.data).toMatchObject({ stepIndex: 0, round: 1 });
    expect(queue.adds[0]!.opts).toMatchObject({ delay: 10 * 60_000 });
  });

  it("stops once the repeat budget is spent", async () => {
    const { prisma } = escPrisma({
      policy: { repeatCount: 1, steps: [{ position: 1, delayMinutes: 0, targets: [user(ALICE.id)] }] },
      users: [ALICE],
    });
    const queue = fakeQueue();
    const result = await createEscalationProcessor({ prisma, queue, alerts })(job({ stepIndex: 1, round: 1 }));
    expect(result.skipped).toBe("exhausted");
    expect(queue.adds).toHaveLength(0);
  });
});

describe("mixed targets", () => {
  it("pages humans and dispatches channels in the same step", async () => {
    const { prisma } = escPrisma({
      policy: oneStep([user(ALICE.id), channel("ch_1"), channel("ch_2")]),
      users: [ALICE],
    });
    const { notifier, paged } = fakeResponders();

    const result = await createEscalationProcessor({
      prisma, queue: fakeQueue(), alerts, responders: notifier,
    })(job());

    expect(paged).toHaveLength(1);
    expect(result.channelsPaged).toBe(2);
  });
});
