import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import type { BillingProvider } from "@backend-uptime/billing";
import { createBillingService } from "../src/services/billing.service.js";
import type { BillingService, PlanView } from "../src/services/billing.service.js";
import type { PlanLimitsService } from "../src/services/plan-limits.service.js";
import { buildServer, headerGetSession } from "./helpers.js";

// ── Route RBAC (billing:read for GET, billing:manage for mutations) ──────────

function prismaWithRole(role: string | null): PrismaClient {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    member: {
      findFirst: async (args: { where: { organizationId: string; userId: string } }) =>
        role
          ? {
              id: "mem_1",
              role,
              organizationId: args.where.organizationId,
              userId: args.where.userId,
              organization: {
                id: args.where.organizationId,
                name: "Acme",
                slug: "acme",
                logo: null,
                createdAt: new Date(),
              },
            }
          : null,
    },
  } as unknown as PrismaClient;
}

const fakeBilling: BillingService = {
  listPlans: async () => [],
  getSummary: async () => ({
    subscription: {
      plan: "FREE",
      status: "ACTIVE",
      seats: 1,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      hasStripeCustomer: false,
    },
    plan: {} as never,
  }),
  listInvoices: async () => [],
  startCheckout: async () => ({ url: "https://checkout.stripe.com/c/cs_1" }),
  openPortal: async () => ({ url: "https://billing.stripe.com/p/1" }),
  changePlan: async () => {},
  cancel: async () => {},
};

const BASE = "/v1/organizations/org_demo/billing";
const app = (role: string | null) =>
  buildServer({ prisma: prismaWithRole(role), getSession: headerGetSession, services: { billing: fakeBilling } });

describe("billing routes RBAC", () => {
  it("viewer can read the billing summary", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.subscription.plan).toBe("FREE");
  });

  it("developer (no billing grant) is forbidden from reading billing", async () => {
    const res = await request(app("developer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });

  it("admin can read but cannot manage (checkout)", async () => {
    const read = await request(app("admin")).get(BASE).set("x-test-user", "u1");
    expect(read.status).toBe(200);
    const manage = await request(app("admin"))
      .post(`${BASE}/checkout`)
      .set("x-test-user", "u1")
      .send({ tier: "GROWTH" });
    expect(manage.status).toBe(403);
  });

  it("owner can start checkout", async () => {
    const res = await request(app("owner"))
      .post(`${BASE}/checkout`)
      .set("x-test-user", "u1")
      .send({ tier: "GROWTH" });
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(/checkout\.stripe\.com/);
  });

  it("rejects an unknown tier with a validation error", async () => {
    const res = await request(app("owner"))
      .post(`${BASE}/checkout`)
      .set("x-test-user", "u1")
      .send({ tier: "PLATINUM" });
    expect(res.status).toBe(400);
  });

  it("owner can cancel (204)", async () => {
    const res = await request(app("owner")).post(`${BASE}/cancel`).set("x-test-user", "u1").send({});
    expect(res.status).toBe(204);
  });
});

// ── Billing service logic (real service + fake prisma + fake provider) ───────

const planLimitsStub = { getSummary: async () => ({}) } as unknown as PlanLimitsService;

function makeProvider(): BillingProvider {
  return {
    ensureCustomer: vi.fn(async () => "cus_new"),
    createCheckoutSession: vi.fn(async () => ({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" })),
    createPortalSession: vi.fn(async () => ({ url: "https://billing.stripe.com/p/1" })),
    changePlan: vi.fn(async () => {}),
    cancelSubscription: vi.fn(async () => {}),
    verifyWebhook: vi.fn(),
  } as unknown as BillingProvider;
}

function svcPrisma(opts: {
  subscription?: Record<string, unknown> | null;
  plansByTier?: Record<string, unknown>;
  invoices?: unknown[];
  plansList?: unknown[];
}): PrismaClient {
  const plansByTier = opts.plansByTier ?? {};
  return {
    subscription: {
      findUnique: async () => opts.subscription ?? null,
      upsert: async () => ({}),
    },
    billingPlan: {
      findUnique: async ({ where }: { where: { tier: string } }) => plansByTier[where.tier] ?? null,
      findMany: async () => opts.plansList ?? [],
    },
    invoiceEvent: { findMany: async () => opts.invoices ?? [] },
  } as unknown as PrismaClient;
}

describe("billing service", () => {
  it("startCheckout reuses an existing customer and returns the session url", async () => {
    const provider = makeProvider();
    const svc = createBillingService({
      prisma: svcPrisma({
        subscription: { stripeCustomerId: "cus_existing" },
        plansByTier: { GROWTH: { name: "Growth", stripePriceId: "price_growth" } },
      }),
      plans: planLimitsStub,
      provider,
      webUrl: "https://app.test",
    });
    const res = await svc.startCheckout("org_1", { tier: "GROWTH" }, actor(), "Acme");
    expect(res.url).toMatch(/checkout\.stripe\.com/);
    expect(provider.ensureCustomer).not.toHaveBeenCalled(); // reused existing customer
    expect(provider.createCheckoutSession).toHaveBeenCalledOnce();
  });

  it("startCheckout creates a customer when the org has none", async () => {
    const provider = makeProvider();
    const svc = createBillingService({
      prisma: svcPrisma({
        subscription: { stripeCustomerId: null },
        plansByTier: { GROWTH: { name: "Growth", stripePriceId: "price_growth" } },
      }),
      plans: planLimitsStub,
      provider,
      webUrl: "https://app.test",
    });
    await svc.startCheckout("org_1", { tier: "GROWTH" }, actor(), "Acme");
    expect(provider.ensureCustomer).toHaveBeenCalledOnce();
  });

  it("startCheckout rejects a plan without a Stripe price", async () => {
    const svc = createBillingService({
      prisma: svcPrisma({ plansByTier: { STARTER: { name: "Starter", stripePriceId: null } } }),
      plans: planLimitsStub,
      provider: makeProvider(),
      webUrl: "https://app.test",
    });
    await expect(svc.startCheckout("org_1", { tier: "STARTER" }, actor(), "Acme")).rejects.toMatchObject({
      code: "bad_request",
    });
  });

  it("startCheckout fails with 503 when billing is not configured", async () => {
    const svc = createBillingService({
      prisma: svcPrisma({ plansByTier: { GROWTH: { name: "Growth", stripePriceId: "price_growth" } } }),
      plans: planLimitsStub,
      provider: undefined,
      webUrl: "https://app.test",
    });
    await expect(svc.startCheckout("org_1", { tier: "GROWTH" }, actor(), "Acme")).rejects.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("openPortal errors when there is no Stripe customer yet", async () => {
    const svc = createBillingService({
      prisma: svcPrisma({ subscription: { stripeCustomerId: null } }),
      plans: planLimitsStub,
      provider: makeProvider(),
      webUrl: "https://app.test",
    });
    await expect(svc.openPortal("org_1", actor())).rejects.toMatchObject({ code: "conflict" });
  });

  it("changePlan errors when there is no active subscription", async () => {
    const svc = createBillingService({
      prisma: svcPrisma({
        subscription: { stripeSubscriptionId: null },
        plansByTier: { GROWTH: { name: "Growth", stripePriceId: "price_growth" } },
      }),
      plans: planLimitsStub,
      provider: makeProvider(),
      webUrl: "https://app.test",
    });
    await expect(svc.changePlan("org_1", { tier: "GROWTH" }, actor())).rejects.toMatchObject({ code: "conflict" });
  });

  it("cancel delegates to the provider", async () => {
    const provider = makeProvider();
    const svc = createBillingService({
      prisma: svcPrisma({ subscription: { stripeSubscriptionId: "sub_1" } }),
      plans: planLimitsStub,
      provider,
      webUrl: "https://app.test",
    });
    await svc.cancel("org_1", { atPeriodEnd: true }, actor());
    expect(provider.cancelSubscription).toHaveBeenCalledWith({ subscriptionId: "sub_1", atPeriodEnd: true });
  });

  it("listPlans marks plans with a Stripe price as purchasable", async () => {
    const svc = createBillingService({
      prisma: svcPrisma({
        plansList: [
          { tier: "FREE", name: "Free", description: null, priceCents: 0, currency: "usd", monitorLimit: 10, seatLimit: 1, statusPageLimit: 1, smsEnabled: false, voiceEnabled: false, ssoEnabled: false, advancedAnalytics: false, stripePriceId: null },
          { tier: "GROWTH", name: "Growth", description: null, priceCents: 9900, currency: "usd", monitorLimit: 250, seatLimit: 20, statusPageLimit: 10, smsEnabled: true, voiceEnabled: false, ssoEnabled: false, advancedAnalytics: false, stripePriceId: "price_growth" },
        ],
      }),
      plans: planLimitsStub,
      provider: makeProvider(),
      webUrl: "https://app.test",
    });
    const plans: PlanView[] = await svc.listPlans();
    expect(plans.find((p) => p.tier === "FREE")!.purchasable).toBe(false);
    expect(plans.find((p) => p.tier === "GROWTH")!.purchasable).toBe(true);
  });
});

function actor() {
  return {
    userId: "u1",
    actorType: "user" as const,
    email: "owner@acme.test",
    ipAddress: null,
    userAgent: null,
  };
}
