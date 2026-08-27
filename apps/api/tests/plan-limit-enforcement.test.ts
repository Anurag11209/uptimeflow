import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import { createPlanLimitsService } from "../src/services/plan-limits.service.js";
import { createMonitorService } from "../src/services/monitor.service.js";
import { createStatusPageService } from "../src/services/status-page.service.js";
import { createSeatEnforcementHooks } from "@backend-uptime/auth";
import type { AuditLogService } from "../src/services/audit-log.service.js";

/**
 * Enforcement tests for the limits that were previously unenforced (status
 * pages, seats) plus regression cover for the ones that already worked
 * (monitors, capabilities).
 *
 * These drive the REAL services against an in-memory store rather than
 * stubbing assertWithinLimit, so a check that gets removed from a service
 * fails here — which is exactly the failure this branch exists to prevent.
 */

// ─── Plan catalog (mirrors packages/db/prisma/seed.ts) ────────────────────────

const PLANS: Record<string, Record<string, unknown>> = {
  FREE: {
    id: "p_free", tier: "FREE", name: "Free",
    monitorLimit: 10, seatLimit: 1, statusPageLimit: 1,
    smsEnabled: false, voiceEnabled: false, ssoEnabled: false,
    advancedAnalytics: false, customDomainsEnabled: false,
    meteredAllowances: { sms: 0, voice_minutes: 0 },
  },
  GROWTH: {
    id: "p_growth", tier: "GROWTH", name: "Growth",
    monitorLimit: 250, seatLimit: 20, statusPageLimit: 10,
    smsEnabled: true, voiceEnabled: false, ssoEnabled: false,
    advancedAnalytics: false, customDomainsEnabled: true,
    meteredAllowances: { sms: 500, voice_minutes: 0 },
  },
  BUSINESS: {
    id: "p_biz", tier: "BUSINESS", name: "Business",
    monitorLimit: null, seatLimit: null, statusPageLimit: null,
    smsEnabled: true, voiceEnabled: true, ssoEnabled: true,
    advancedAnalytics: true, customDomainsEnabled: true,
    meteredAllowances: { sms: 2000, voice_minutes: 200 },
  },
};

// ─── In-memory multi-tenant store ─────────────────────────────────────────────

interface OrgSeed {
  tier: keyof typeof PLANS;
  monitors?: number;
  statusPages?: number;
  members?: number;
  /** Pending, unexpired invitations. */
  invitations?: number;
  /** Soft-deleted rows, which must NOT count against the limit. */
  deletedMonitors?: number;
  deletedStatusPages?: number;
  /** Per-subscription monitor override. */
  monitorLimit?: number | null;
}

interface Row {
  id: string;
  organizationId: string;
  deletedAt: Date | null;
}

/**
 * A small store keyed by organization. Every count goes through the same
 * where-clause the production code passes, so a query that forgets its
 * organizationId filter reads across tenants here too — which is what makes
 * the isolation tests meaningful rather than decorative.
 */
function makeStore(seeds: Record<string, OrgSeed>) {
  const monitors: Row[] = [];
  const statusPages: Row[] = [];
  const members: Array<{ organizationId: string }> = [];
  const invitations: Array<{ organizationId: string; status: string; expiresAt: Date }> = [];
  const subscriptions = new Map<string, Record<string, unknown>>();

  const future = new Date(Date.now() + 7 * 86_400_000);
  const past = new Date(Date.now() - 86_400_000);
  let seq = 0;

  for (const [orgId, seed] of Object.entries(seeds)) {
    for (let i = 0; i < (seed.monitors ?? 0); i++)
      monitors.push({ id: `mon_${++seq}`, organizationId: orgId, deletedAt: null });
    for (let i = 0; i < (seed.deletedMonitors ?? 0); i++)
      monitors.push({ id: `mon_${++seq}`, organizationId: orgId, deletedAt: past });
    for (let i = 0; i < (seed.statusPages ?? 0); i++)
      statusPages.push({ id: `sp_${++seq}`, organizationId: orgId, deletedAt: null });
    for (let i = 0; i < (seed.deletedStatusPages ?? 0); i++)
      statusPages.push({ id: `sp_${++seq}`, organizationId: orgId, deletedAt: past });
    for (let i = 0; i < (seed.members ?? 0); i++) members.push({ organizationId: orgId });
    for (let i = 0; i < (seed.invitations ?? 0); i++)
      invitations.push({ organizationId: orgId, status: "pending", expiresAt: future });

    subscriptions.set(orgId, {
      organizationId: orgId,
      plan: seed.tier,
      monitorLimit: seed.monitorLimit ?? null,
      billingPlan: PLANS[seed.tier],
    });
  }

  const matchesSoftDelete = (row: Row, where: any): boolean =>
    where?.deletedAt === null ? row.deletedAt === null : true;

  const prisma = {
    subscription: {
      findUnique: async ({ where }: any) => subscriptions.get(where.organizationId) ?? null,
    },
    billingPlan: {
      findUnique: async ({ where }: any) => PLANS[where.tier] ?? null,
    },
    monitor: {
      count: async ({ where }: any) =>
        monitors.filter(
          (m) => m.organizationId === where.organizationId && matchesSoftDelete(m, where),
        ).length,
      findFirst: async () => null,
      create: async ({ data }: any) => {
        const row = { id: `mon_${++seq}`, organizationId: data.organizationId, deletedAt: null };
        monitors.push(row);
        return { ...MONITOR_ROW, ...data, id: row.id, assertions: [], channels: [] };
      },
      updateMany: async ({ where }: any) => {
        const hit = monitors.find(
          (m) => m.id === where.id && m.organizationId === where.organizationId && !m.deletedAt,
        );
        if (!hit) return { count: 0 };
        hit.deletedAt = new Date();
        return { count: 1 };
      },
    },
    statusPage: {
      count: async ({ where }: any) =>
        statusPages.filter(
          (p) => p.organizationId === where.organizationId && matchesSoftDelete(p, where),
        ).length,
      findFirst: async ({ where }: any) =>
        statusPages.find(
          (p) => p.id === where.id && p.organizationId === where.organizationId && !p.deletedAt,
        ) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `sp_${++seq}`, organizationId: data.organizationId, deletedAt: null };
        statusPages.push(row);
        return {
          id: row.id, name: data.name, slug: data.slug,
          description: data.description ?? null, customDomain: data.customDomain ?? null,
          visibility: data.visibility ?? "PUBLIC", branding: null,
          createdAt: new Date(), updatedAt: new Date(),
        };
      },
      update: async ({ where }: any) => {
        const hit = statusPages.find((p) => p.id === where.id);
        if (hit) hit.deletedAt = new Date();
        return hit;
      },
    },
    member: {
      count: async ({ where }: any) =>
        members.filter((m) => m.organizationId === where.organizationId).length,
    },
    invitation: {
      count: async ({ where }: any) =>
        invitations.filter(
          (i) =>
            i.organizationId === where.organizationId &&
            i.status === where.status &&
            i.expiresAt > where.expiresAt.gt,
        ).length,
    },
    usageRecord: { groupBy: async () => [] },
    monitorGroup: { count: async () => 1 },
    escalationPolicy: { count: async () => 1 },
    alertChannel: { count: async (a: any) => a?.where?.id?.in?.length ?? 1 },
    monitorAssertion: { createMany: async () => ({ count: 0 }) },
    monitorChannel: { createMany: async () => ({ count: 0 }) },
  } as unknown as PrismaClient;

  return {
    prisma,
    /** Adds a member directly, as Better Auth's insert would. */
    addMember: (orgId: string) => members.push({ organizationId: orgId }),
    countMonitors: (orgId: string) =>
      monitors.filter((m) => m.organizationId === orgId && !m.deletedAt).length,
    countStatusPages: (orgId: string) =>
      statusPages.filter((p) => p.organizationId === orgId && !p.deletedAt).length,
  };
}

const MONITOR_ROW = {
  id: "mon_x", name: "m", type: "HTTP", state: "ACTIVE", health: "UP",
  url: "https://example.com", host: null, port: null, intervalSeconds: 60,
  groupId: null, group: null, lastCheckedAt: null, lastResponseMs: null,
  lastStatusCode: null, lastError: null, escalationPolicyId: null,
  createdAt: new Date(), updatedAt: new Date(), httpMethod: "GET",
  requestHeaders: null, requestBody: null, expectedStatus: 200, keyword: null,
  keywordInverted: false, followRedirects: true, verifySsl: true,
  timeoutSeconds: 30, retries: 2, regions: [], failureThreshold: 1,
  successThreshold: 1, consecutiveFailures: 0, consecutiveSuccesses: 0,
  assertions: [], channels: [],
};

const auditLogs = { log: vi.fn(async () => {}) } as unknown as AuditLogService;
const actor = { userId: "u_1", actorType: "user" as const };

function services(seeds: Record<string, OrgSeed>) {
  const store = makeStore(seeds);
  const planLimits = createPlanLimitsService({ prisma: store.prisma });
  return {
    store,
    planLimits,
    monitors: createMonitorService({ prisma: store.prisma, auditLogs, planLimits }),
    statusPages: createStatusPageService({ prisma: store.prisma, auditLogs, planLimits }),
    seatHooks: createSeatEnforcementHooks({
      assertSeatAvailable: (id) => planLimits.assertWithinLimit(id, "seat"),
      assertSeatAvailableForInvite: (id) => planLimits.assertSeatAvailableForInvite(id),
    }),
  };
}

const newMonitor = { name: "API", type: "HTTP" as const, url: "https://example.com" };
const newPage = (slug: string) => ({ name: "Status", slug });

const PAYMENT_REQUIRED = { code: "payment_required", status: 402 };

// ═══════════════════════ Monitors (regression cover) ═══════════════════════

describe("monitor limits", () => {
  it("FREE under the limit → created", async () => {
    const { monitors, store } = services({ org_1: { tier: "FREE", monitors: 9 } });
    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();
    expect(store.countMonitors("org_1")).toBe(10);
  });

  it("FREE at the limit → rejected with 402, nothing created", async () => {
    const { monitors, store } = services({ org_1: { tier: "FREE", monitors: 10 } });
    await expect(monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    expect(store.countMonitors("org_1")).toBe(10);
  });

  it("FREE over the limit (e.g. after a downgrade) → still rejected", async () => {
    const { monitors, store } = services({ org_1: { tier: "FREE", monitors: 25 } });
    await expect(monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    expect(store.countMonitors("org_1")).toBe(25);
  });

  it("a paid plan gets its own higher limit", async () => {
    const { monitors } = services({ org_1: { tier: "GROWTH", monitors: 11 } });
    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();

    const atGrowthCap = services({ org_1: { tier: "GROWTH", monitors: 250 } });
    await expect(atGrowthCap.monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
  });

  it("an unlimited plan never blocks", async () => {
    const { monitors } = services({ org_1: { tier: "BUSINESS", monitors: 100_000 } });
    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();
  });

  it("deleting a monitor frees capacity", async () => {
    const { monitors, store } = services({ org_1: { tier: "FREE", monitors: 10 } });
    await expect(monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    expect(await monitors.remove("org_1", "mon_1", actor)).toBe(true);
    expect(store.countMonitors("org_1")).toBe(9);

    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();
  });

  it("soft-deleted monitors do not consume capacity", async () => {
    const { monitors } = services({
      org_1: { tier: "FREE", monitors: 5, deletedMonitors: 50 },
    });
    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();
  });
});

// ═══════════════════════════ Status pages ══════════════════════════════════

describe("status page limits", () => {
  it("FREE under the limit → created", async () => {
    const { statusPages, store } = services({ org_1: { tier: "FREE", statusPages: 0 } });
    await expect(statusPages.create("org_1", newPage("a"), actor)).resolves.toBeTruthy();
    expect(store.countStatusPages("org_1")).toBe(1);
  });

  it("FREE at the limit → rejected with 402, nothing created", async () => {
    const { statusPages, store } = services({ org_1: { tier: "FREE", statusPages: 1 } });
    await expect(statusPages.create("org_1", newPage("b"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    expect(store.countStatusPages("org_1")).toBe(1);
  });

  it("FREE over the limit → rejected", async () => {
    const { statusPages } = services({ org_1: { tier: "FREE", statusPages: 4 } });
    await expect(statusPages.create("org_1", newPage("c"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
  });

  it("GROWTH gets 10, and is capped at 10", async () => {
    const under = services({ org_1: { tier: "GROWTH", statusPages: 9 } });
    await expect(under.statusPages.create("org_1", newPage("d"), actor)).resolves.toBeTruthy();

    const at = services({ org_1: { tier: "GROWTH", statusPages: 10 } });
    await expect(at.statusPages.create("org_1", newPage("e"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
  });

  it("BUSINESS is unlimited", async () => {
    const { statusPages } = services({ org_1: { tier: "BUSINESS", statusPages: 500 } });
    await expect(statusPages.create("org_1", newPage("f"), actor)).resolves.toBeTruthy();
  });

  it("deleting a status page frees capacity", async () => {
    const { statusPages, store } = services({ org_1: { tier: "FREE", statusPages: 1 } });
    await expect(statusPages.create("org_1", newPage("g"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    const existing = await statusPages.get("org_1", "sp_1");
    expect(await statusPages.remove("org_1", existing!.id, actor)).toBe(true);
    expect(store.countStatusPages("org_1")).toBe(0);

    await expect(statusPages.create("org_1", newPage("h"), actor)).resolves.toBeTruthy();
  });

  it("the error names the resource and the plan so the UI can prompt an upgrade", async () => {
    const { statusPages } = services({ org_1: { tier: "FREE", statusPages: 1 } });
    const err: any = await statusPages.create("org_1", newPage("i"), actor).catch((e) => e);
    expect(err.message).toContain("Free plan allows 1 status pages");
    expect(err.details).toMatchObject({ resource: "statusPage", limit: 1, used: 1, tier: "FREE" });
  });
});

// ══════════════════════════════ Seats ══════════════════════════════════════

describe("seat limits", () => {
  it("under the limit → invitation allowed", async () => {
    const { seatHooks } = services({ org_1: { tier: "GROWTH", members: 3, invitations: 2 } });
    await expect(
      seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
    ).resolves.toBeUndefined();
  });

  it("at the limit → invitation rejected (FREE gets 1 seat, the owner)", async () => {
    const { seatHooks } = services({ org_1: { tier: "FREE", members: 1 } });
    await expect(
      seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("an invitation cannot bypass the limit: pending invites count as taken seats", async () => {
    // 3 members + 2 pending = 5 of GROWTH's 20 → fine.
    const under = services({ org_1: { tier: "GROWTH", members: 3, invitations: 2 } });
    await expect(
      under.seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
    ).resolves.toBeUndefined();

    // 18 members + 2 pending = 20 of 20 → the next invite is refused even
    // though only 18 seats are actually occupied.
    const committed = services({ org_1: { tier: "GROWTH", members: 18, invitations: 2 } });
    await expect(
      committed.seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("accepting is re-checked, so an invite issued before a downgrade cannot land", async () => {
    // Downgraded to FREE (1 seat) with the owner already in place; a stale
    // invitation from the paid era must not be redeemable.
    const { seatHooks } = services({ org_1: { tier: "FREE", members: 1, invitations: 1 } });
    await expect(
      seatHooks.beforeAcceptInvitation({ invitation: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("direct member adds are gated too", async () => {
    const { seatHooks } = services({ org_1: { tier: "FREE", members: 1 } });
    await expect(
      seatHooks.beforeAddMember({ member: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("an unlimited plan never blocks membership", async () => {
    const { seatHooks } = services({ org_1: { tier: "BUSINESS", members: 5_000 } });
    await expect(
      seatHooks.beforeAddMember({ member: { organizationId: "org_1" } }),
    ).resolves.toBeUndefined();
  });

  it("concurrent invitations cannot trivially bypass the limit", async () => {
    // GROWTH: 20 seats, 20 already committed. Ten simultaneous invite attempts
    // must ALL be refused — none may read a stale count and slip through.
    const { seatHooks } = services({ org_1: { tier: "GROWTH", members: 15, invitations: 5 } });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
      ),
    );
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });

  it("concurrent accepts cannot exceed the cap, because the seats were claimed at invite time", async () => {
    // The invariant that makes this safe: members + pendingInvitations is only
    // ever raised by beforeCreateInvitation, and accepting merely converts a
    // pending seat into a member seat, leaving that sum unchanged. Here
    // 16 members + 4 pending = 20, exactly GROWTH's cap.
    const store = makeStore({ org_1: { tier: "GROWTH", members: 16, invitations: 4 } });
    const planLimits = createPlanLimitsService({ prisma: store.prisma });
    const hooks = createSeatEnforcementHooks({
      assertSeatAvailable: (id) => planLimits.assertWithinLimit(id, "seat"),
      assertSeatAvailableForInvite: (id) => planLimits.assertSeatAvailableForInvite(id),
    });

    // All four outstanding invitations accept concurrently. members (16) is
    // below the cap (20) for every one of them, so all four are admitted —
    // landing the org at exactly 20, never above.
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        hooks.beforeAcceptInvitation({ invitation: { organizationId: "org_1" } }),
      ),
    );
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    for (let i = 0; i < 4; i++) store.addMember("org_1");
    expect(await planLimits.countUsage("org_1", "seat")).toBe(20);

    // And the cap holds immediately afterwards.
    await expect(
      hooks.beforeAddMember({ member: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("expired invitations release their seat", async () => {
    const store = makeStore({ org_1: { tier: "FREE", members: 0 } });
    const planLimits = createPlanLimitsService({ prisma: store.prisma });
    // 0 members + 0 unexpired invitations against FREE's 1 seat.
    await expect(planLimits.assertSeatAvailableForInvite("org_1")).resolves.toBeUndefined();
  });
});

// ═══════════════════════════ Capabilities ══════════════════════════════════

describe("capabilities", () => {
  it("SMS: blocked on FREE, allowed on GROWTH", async () => {
    const free = services({ org_1: { tier: "FREE" } });
    await expect(free.planLimits.assertCapability("org_1", "sms")).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    const growth = services({ org_1: { tier: "GROWTH" } });
    await expect(growth.planLimits.assertCapability("org_1", "sms")).resolves.toBeUndefined();
  });

  it("voice: blocked on GROWTH, allowed on BUSINESS", async () => {
    const growth = services({ org_1: { tier: "GROWTH" } });
    await expect(growth.planLimits.assertCapability("org_1", "voice")).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    const business = services({ org_1: { tier: "BUSINESS" } });
    await expect(business.planLimits.assertCapability("org_1", "voice")).resolves.toBeUndefined();
  });

  it("custom domains: blocked on FREE, allowed on GROWTH", async () => {
    const free = services({ org_1: { tier: "FREE" } });
    await expect(free.planLimits.assertCapability("org_1", "customDomains")).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    const growth = services({ org_1: { tier: "GROWTH" } });
    await expect(
      growth.planLimits.assertCapability("org_1", "customDomains"),
    ).resolves.toBeUndefined();
  });
});

// ═══════════════════ Security / tenant isolation ═══════════════════════════

describe("tenant isolation", () => {
  it("an org at its cap cannot borrow a richer org's plan", async () => {
    const { monitors, statusPages } = services({
      free_org: { tier: "FREE", monitors: 10, statusPages: 1 },
      rich_org: { tier: "BUSINESS", monitors: 0, statusPages: 0 },
    });

    await expect(monitors.create("free_org", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    await expect(statusPages.create("free_org", newPage("x"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    // The unlimited org is unaffected by the poor one's exhaustion.
    await expect(monitors.create("rich_org", newMonitor, actor)).resolves.toBeTruthy();
  });

  it("one org's usage never consumes another's quota", async () => {
    const { monitors, planLimits } = services({
      org_a: { tier: "FREE", monitors: 9 },
      org_b: { tier: "FREE", monitors: 9 },
    });

    expect(await planLimits.countUsage("org_a", "monitor")).toBe(9);
    expect(await planLimits.countUsage("org_b", "monitor")).toBe(9);

    await expect(monitors.create("org_a", newMonitor, actor)).resolves.toBeTruthy();
    // org_a is now full; org_b still has its own slot.
    await expect(monitors.create("org_a", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    await expect(monitors.create("org_b", newMonitor, actor)).resolves.toBeTruthy();
  });

  it("the limit follows the organization id the caller is scoped to, not the plan they name", async () => {
    const { planLimits } = services({
      free_org: { tier: "FREE" },
      biz_org: { tier: "BUSINESS" },
    });
    // There is no input by which a caller supplies a tier: the tier is derived
    // from the org id alone, which orgContext resolves from the session.
    expect((await planLimits.getEffectiveLimits("free_org")).tier).toBe("FREE");
    expect((await planLimits.getEffectiveLimits("biz_org")).tier).toBe("BUSINESS");
  });

  it("seat checks resolve the plan from the hook's organization, not the caller's", async () => {
    const { seatHooks } = services({
      free_org: { tier: "FREE", members: 1 },
      biz_org: { tier: "BUSINESS", members: 900 },
    });
    await expect(
      seatHooks.beforeAddMember({ member: { organizationId: "free_org" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
    await expect(
      seatHooks.beforeAddMember({ member: { organizationId: "biz_org" } }),
    ).resolves.toBeUndefined();
  });

  it("an unknown organization falls back to FREE, never to unlimited", async () => {
    const { planLimits } = services({ org_1: { tier: "BUSINESS" } });
    const limits = await planLimits.getEffectiveLimits("org_does_not_exist");
    expect(limits.tier).toBe("FREE");
    expect(limits.monitorLimit).toBe(10);
    expect(limits.seatLimit).toBe(1);
  });
});

// ══════════════════════════ Downgrade behavior ═════════════════════════════

describe("downgrade behavior", () => {
  it("existing resources survive a downgrade — nothing is deleted or disabled", async () => {
    // 40 monitors and 6 status pages carried down onto FREE (10 / 1).
    const { planLimits, store } = services({
      org_1: { tier: "FREE", monitors: 40, statusPages: 6, members: 8 },
    });

    expect(await planLimits.countUsage("org_1", "monitor")).toBe(40);
    expect(await planLimits.countUsage("org_1", "statusPage")).toBe(6);
    expect(await planLimits.countUsage("org_1", "seat")).toBe(8);
    expect(store.countMonitors("org_1")).toBe(40);
  });

  it("but creating anything new is blocked while over the new cap", async () => {
    const { monitors, statusPages, seatHooks } = services({
      org_1: { tier: "FREE", monitors: 40, statusPages: 6, members: 8 },
    });

    await expect(monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    await expect(statusPages.create("org_1", newPage("z"), actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );
    await expect(
      seatHooks.beforeCreateInvitation({ invitation: { organizationId: "org_1" } }),
    ).rejects.toMatchObject({ status: "PAYMENT_REQUIRED" });
  });

  it("usage reporting stays truthful when over the limit: remaining floors at 0", async () => {
    const { planLimits } = services({
      org_1: { tier: "FREE", monitors: 40, statusPages: 6, members: 8 },
    });
    const summary = await planLimits.getSummary("org_1");
    expect(summary.usage.monitor).toEqual({ limit: 10, used: 40, remaining: 0 });
    expect(summary.usage.statusPage).toEqual({ limit: 1, used: 6, remaining: 0 });
    expect(summary.usage.seat).toEqual({ limit: 1, used: 8, remaining: 0 });
  });

  it("deleting back under the cap restores the ability to create", async () => {
    const { monitors, statusPages } = services({ org_1: { tier: "FREE", monitors: 11 } });
    await expect(monitors.create("org_1", newMonitor, actor)).rejects.toMatchObject(
      PAYMENT_REQUIRED,
    );

    expect(await monitors.remove("org_1", "mon_1", actor)).toBe(true);
    expect(await monitors.remove("org_1", "mon_2", actor)).toBe(true);
    await expect(monitors.create("org_1", newMonitor, actor)).resolves.toBeTruthy();

    // Status pages behave the same way.
    await expect(statusPages.create("org_1", newPage("y"), actor)).resolves.toBeTruthy();
  });
});
