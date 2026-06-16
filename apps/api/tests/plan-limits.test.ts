import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { pino } from "pino";
import { AppError } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { createPlanLimitsService } from "../src/services/plan-limits.service.js";
import { enforceLimit, requireCapability } from "../src/middleware/enforce-limit.js";
import { errorHandler } from "../src/middleware/error-handler.js";

const GROWTH = {
  id: "p_g",
  tier: "GROWTH",
  name: "Growth",
  monitorLimit: 250,
  seatLimit: 20,
  statusPageLimit: 10,
  smsEnabled: true,
  voiceEnabled: false,
  ssoEnabled: false,
  advancedAnalytics: false,
  customDomainsEnabled: true,
  meteredAllowances: { sms: 500, voice_minutes: 0 },
};
const FREE = {
  id: "p_f",
  tier: "FREE",
  name: "Free",
  monitorLimit: 10,
  seatLimit: 1,
  statusPageLimit: 1,
  smsEnabled: false,
  voiceEnabled: false,
  ssoEnabled: false,
  advancedAnalytics: false,
  customDomainsEnabled: false,
  meteredAllowances: { sms: 0, voice_minutes: 0 },
};

interface FakeOpts {
  subscription?: Record<string, unknown> | null;
  plansByTier?: Record<string, unknown>;
  counts?: { monitor?: number; seat?: number; statusPage?: number };
  usage?: Array<{ metric: string; _sum: { quantity: number | null } }>;
}

function fakePrisma(opts: FakeOpts): PrismaClient {
  const plansByTier = opts.plansByTier ?? { FREE, GROWTH };
  return {
    subscription: { findUnique: async () => opts.subscription ?? null },
    billingPlan: {
      findUnique: async ({ where }: { where: { tier: string } }) => plansByTier[where.tier] ?? null,
    },
    monitor: { count: async () => opts.counts?.monitor ?? 0 },
    member: { count: async () => opts.counts?.seat ?? 0 },
    statusPage: { count: async () => opts.counts?.statusPage ?? 0 },
    usageRecord: { groupBy: async () => opts.usage ?? [] },
  } as unknown as PrismaClient;
}

describe("plan limits service", () => {
  it("resolves effective limits from the subscription's plan", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "GROWTH", monitorLimit: null, billingPlan: GROWTH } }),
    });
    const limits = await svc.getEffectiveLimits("org_1");
    expect(limits.tier).toBe("GROWTH");
    expect(limits.monitorLimit).toBe(250);
    expect(limits.smsEnabled).toBe(true);
  });

  it("a per-subscription monitor override wins over the plan default", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "GROWTH", monitorLimit: 5, billingPlan: GROWTH } }),
    });
    expect((await svc.getEffectiveLimits("org_1")).monitorLimit).toBe(5);
  });

  it("falls back to the FREE catalog plan when the org has no subscription", async () => {
    const svc = createPlanLimitsService({ prisma: fakePrisma({ subscription: null }) });
    const limits = await svc.getEffectiveLimits("org_1");
    expect(limits.tier).toBe("FREE");
    expect(limits.monitorLimit).toBe(10);
  });

  it("assertWithinLimit allows creation below the limit", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE }, counts: { monitor: 9 } }),
    });
    await expect(svc.assertWithinLimit("org_1", "monitor")).resolves.toBeUndefined();
  });

  it("assertWithinLimit throws payment_required at the limit", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE }, counts: { monitor: 10 } }),
    });
    await expect(svc.assertWithinLimit("org_1", "monitor")).rejects.toMatchObject({
      code: "payment_required",
      status: 402,
    });
  });

  it("treats a null limit as unlimited", async () => {
    const unlimited = { ...GROWTH, tier: "BUSINESS", name: "Business", monitorLimit: null };
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "BUSINESS", billingPlan: unlimited }, counts: { monitor: 100000 } }),
    });
    await expect(svc.assertWithinLimit("org_1", "monitor")).resolves.toBeUndefined();
  });

  it("assertCapability blocks a capability the plan lacks", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE } }),
    });
    await expect(svc.assertCapability("org_1", "sms")).rejects.toMatchObject({ code: "payment_required" });
  });

  it("assertCapability allows a capability the plan includes", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "GROWTH", billingPlan: GROWTH } }),
    });
    await expect(svc.assertCapability("org_1", "sms")).resolves.toBeUndefined();
  });

  it("custom domains: blocked on FREE, allowed on GROWTH", async () => {
    const free = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE } }),
    });
    await expect(free.assertCapability("org_1", "customDomains")).rejects.toMatchObject({
      code: "payment_required",
      status: 402,
    });
    const growth = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "GROWTH", billingPlan: GROWTH } }),
    });
    await expect(growth.assertCapability("org_1", "customDomains")).resolves.toBeUndefined();
    expect((await growth.getEffectiveLimits("org_1")).customDomainsEnabled).toBe(true);
  });

  it("getSummary reports usage, remaining, and metered allowances", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({
        subscription: { plan: "GROWTH", billingPlan: GROWTH },
        counts: { monitor: 3, seat: 2, statusPage: 1 },
        usage: [{ metric: "sms", _sum: { quantity: 42 } }],
      }),
    });
    const summary = await svc.getSummary("org_1");
    expect(summary.usage.monitor).toEqual({ limit: 250, used: 3, remaining: 247 });
    expect(summary.usage.metered.sms).toEqual({ used: 42, included: 500 });
  });
});

// ── enforceLimit / requireCapability middleware end-to-end through Express ───

function appWith(handler: express.RequestHandler) {
  const app = express();
  app.use((req, _res, next) => {
    req.orgContext = {
      organizationId: "org_1",
      organization: { id: "org_1", name: "Acme", slug: "acme", logo: null, createdAt: new Date() },
      principal: { type: "session", userId: "u1", memberId: "m1", role: "owner" },
    };
    next();
  });
  app.post("/things", handler, (_req, res) => res.status(201).json({ ok: true }));
  app.use(errorHandler(pino({ level: "silent" })));
  return app;
}

describe("enforceLimit middleware", () => {
  it("passes through when under the limit (201)", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE }, counts: { monitor: 2 } }),
    });
    const res = await request(appWith(enforceLimit(svc, "monitor"))).post("/things");
    expect(res.status).toBe(201);
  });

  it("blocks with a typed 402 (not a 500) when over the limit", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE }, counts: { monitor: 10 } }),
    });
    const res = await request(appWith(enforceLimit(svc, "monitor"))).post("/things");
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("payment_required");
    expect(res.body.error.details).toMatchObject({ resource: "monitor", limit: 10, used: 10 });
  });

  it("requireCapability returns 402 when the plan lacks the capability", async () => {
    const svc = createPlanLimitsService({
      prisma: fakePrisma({ subscription: { plan: "FREE", billingPlan: FREE } }),
    });
    const res = await request(appWith(requireCapability(svc, "voice"))).post("/things");
    expect(res.status).toBe(402);
    expect(res.body.error.code).toBe("payment_required");
  });
});

// Guard: AppError.paymentRequired keeps the 402 status mapping stable.
describe("payment_required error", () => {
  it("maps to HTTP 402", () => {
    expect(AppError.paymentRequired("nope").status).toBe(402);
  });
});
