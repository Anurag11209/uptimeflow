import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { Prisma, type PrismaClient } from "@backend-uptime/db";
import type { BillingProvider } from "@backend-uptime/billing";
import {
  createRazorpayWebhookService,
  type RazorpayEventLike,
} from "../src/services/razorpay-billing-webhook.service.js";
import type { RazorpayWebhookService } from "../src/services/razorpay-billing-webhook.service.js";
import { buildServer } from "./helpers.js";

const WEBHOOK_PATH = "/v1/billing/webhooks/razorpay";

// ── Stateful in-memory Prisma fake (subscriptions + invoice_events) ──────────

interface SubRow {
  id: string;
  organizationId: string;
  plan: string;
  status: string;
  provider?: string;
  razorpayCustomerId?: string | null;
  razorpaySubscriptionId?: string | null;
  razorpayPlanId?: string | null;
  planId?: string | null;
  seats?: number;
  cancelAtPeriodEnd?: boolean;
  canceledAt?: Date | null;
  currentPeriodEnd?: Date | null;
}

function makeFakePrisma(initialSub?: SubRow) {
  const subs = new Map<string, SubRow>();
  if (initialSub) subs.set(initialSub.organizationId, { ...initialSub });
  const events = new Set<string>();
  const invoiceRows: Record<string, unknown>[] = [];
  const plans = [
    { id: "plan_growth", tier: "GROWTH", razorpayPlanId: "plan_growth_rzp" },
    { id: "plan_free", tier: "FREE", razorpayPlanId: null },
  ];

  const tx = {
    subscription: {
      findFirst: async ({ where }: { where: { razorpayCustomerId?: string; razorpaySubscriptionId?: string } }) => {
        for (const s of subs.values()) {
          if (where.razorpaySubscriptionId && s.razorpaySubscriptionId === where.razorpaySubscriptionId) return s;
          if (where.razorpayCustomerId && s.razorpayCustomerId === where.razorpayCustomerId) return s;
        }
        return null;
      },
      findUnique: async ({ where }: { where: { organizationId: string } }) =>
        subs.get(where.organizationId) ?? null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { organizationId: string };
        update: Partial<SubRow>;
        create: SubRow;
      }) => {
        const existing = subs.get(where.organizationId);
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        const row: SubRow = { ...create, id: `sub_${where.organizationId}` };
        subs.set(where.organizationId, row);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: { organizationId: string };
        data: Partial<SubRow>;
      }) => {
        const s = subs.get(where.organizationId);
        if (s) Object.assign(s, data);
        return { count: s ? 1 : 0 };
      },
    },
    billingPlan: {
      findFirst: async ({ where }: { where: { razorpayPlanId?: string } }) =>
        plans.find((p) => p.razorpayPlanId === where.razorpayPlanId) ?? null,
      findUnique: async ({ where }: { where: { tier?: string } }) =>
        plans.find((p) => p.tier === where.tier) ?? null,
    },
    invoiceEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const eid = data.providerEventId as string;
        if (events.has(eid)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        events.add(eid);
        const row = { id: `ie_${eid}`, ...data };
        invoiceRows.push(row);
        return row;
      },
    },
    auditLog: { create: async () => ({}) },
  };

  const prisma = {
    ...tx,
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
  } as unknown as PrismaClient;

  return { prisma, subs, events, invoiceRows };
}

function baseSub(): SubRow {
  return {
    id: "sub_org_1",
    organizationId: "org_1",
    plan: "FREE",
    status: "INCOMPLETE",
    provider: "RAZORPAY",
    razorpayCustomerId: "cust_1",
  };
}

function subscriptionEvent(overrides: Partial<RazorpayEventLike> = {}): RazorpayEventLike {
  return {
    id: "evt_sub_1", // this is the x-razorpay-event-id header value, forwarded by the route
    type: "subscription.activated",
    data: {
      object: {
        id: "sub_rzp_x",
        customer_id: "cust_1",
        plan_id: "plan_growth_rzp",
        status: "active",
        cancel_at_cycle_end: 0,
        current_end: 1893456000,
        quantity: 3,
        notes: { organizationId: "org_1" },
      },
    },
    ...overrides,
  };
}

// ── Service: idempotency + per-event effects ─────────────────────────────────

describe("razorpay webhook service", () => {
  let svc: RazorpayWebhookService;
  let store: ReturnType<typeof makeFakePrisma>;

  function build(initial?: SubRow) {
    store = makeFakePrisma(initial);
    svc = createRazorpayWebhookService({ prisma: store.prisma });
  }

  it("applies a subscription.activated event: plan, status, seats", async () => {
    build(baseSub());
    const outcome = await svc.handleEvent(subscriptionEvent());
    expect(outcome).toBe("applied");
    const sub = store.subs.get("org_1")!;
    expect(sub.plan).toBe("GROWTH");
    expect(sub.planId).toBe("plan_growth");
    expect(sub.status).toBe("ACTIVE");
    expect(sub.seats).toBe(3);
    expect(sub.razorpaySubscriptionId).toBe("sub_rzp_x");
  });

  it("is idempotent: a replayed event is recorded and applied exactly once", async () => {
    build(baseSub());
    const first = await svc.handleEvent(subscriptionEvent());
    const second = await svc.handleEvent(subscriptionEvent());
    expect(first).toBe("applied");
    expect(second).toBe("duplicate");
    expect(store.events.size).toBe(1);
    expect(store.invoiceRows).toHaveLength(1);
  });

  it("subscription.charged marks ACTIVE and records a ledger row", async () => {
    build({ ...baseSub(), status: "PAST_DUE" });
    const outcome = await svc.handleEvent({
      id: "evt_charged_1",
      type: "subscription.charged",
      data: {
        object: {
          id: "sub_rzp_x",
          customer_id: "cust_1",
          plan_id: "plan_growth_rzp",
          status: "active",
          current_end: 1893456000,
          quantity: 1,
          notes: { organizationId: "org_1" },
        },
      },
    });
    expect(outcome).toBe("applied");
    expect(store.subs.get("org_1")!.status).toBe("ACTIVE");
    expect(store.invoiceRows[0]!.type).toBe("PAYMENT_SUCCEEDED");
  });

  it("payment.failed marks the subscription PAST_DUE and records a ledger row", async () => {
    build({ ...baseSub(), razorpaySubscriptionId: "sub_rzp_x" });
    const outcome = await svc.handleEvent({
      id: "evt_pf_1",
      type: "payment.failed",
      data: {
        object: { id: "pay_1", subscription_id: "sub_rzp_x", amount: 9900, currency: "INR", status: "failed" },
      },
    });
    expect(outcome).toBe("applied");
    expect(store.subs.get("org_1")!.status).toBe("PAST_DUE");
    const row = store.invoiceRows[0]!;
    expect(row.type).toBe("PAYMENT_FAILED");
    expect(row.amountCents).toBe(9900);
    expect(row.razorpayPaymentId).toBe("pay_1");
  });

  it("subscription.cancelled reverts the org to the FREE plan", async () => {
    build({
      ...baseSub(),
      plan: "GROWTH",
      planId: "plan_growth",
      status: "ACTIVE",
      razorpaySubscriptionId: "sub_rzp_x",
    });
    const outcome = await svc.handleEvent({
      id: "evt_del_1",
      type: "subscription.cancelled",
      data: { object: { id: "sub_rzp_x", customer_id: "cust_1", status: "cancelled", notes: { organizationId: "org_1" } } },
    });
    expect(outcome).toBe("applied");
    const sub = store.subs.get("org_1")!;
    expect(sub.status).toBe("CANCELED");
    expect(sub.plan).toBe("FREE");
    expect(sub.planId).toBe("plan_free");
    expect(sub.razorpaySubscriptionId).toBeNull();
  });

  it("ignores events outside the handled set", async () => {
    build(baseSub());
    const outcome = await svc.handleEvent({
      id: "evt_x",
      type: "refund.created",
      data: { object: {} },
    });
    expect(outcome).toBe("ignored");
    expect(store.events.size).toBe(0);
  });

  it("ignores events that cannot be attributed to an org", async () => {
    build(); // no subscription, so an unknown subscription id maps to nothing
    const outcome = await svc.handleEvent({
      id: "evt_orphan",
      type: "subscription.charged",
      data: { object: { id: "sub_unknown", customer_id: "cust_unknown" } },
    });
    expect(outcome).toBe("ignored");
    expect(store.events.size).toBe(0);
  });
});

// ── Route: signature verification + availability ─────────────────────────────

const okEvent: RazorpayEventLike = subscriptionEvent();

const fakeProvider = (verify: () => unknown): BillingProvider =>
  ({
    verifyWebhook: verify,
  }) as unknown as BillingProvider;

const fakeService = (outcome: string): RazorpayWebhookService =>
  ({ handleEvent: async () => outcome }) as unknown as RazorpayWebhookService;

describe("razorpay webhook route", () => {
  let prisma: PrismaClient;
  beforeEach(() => {
    prisma = makeFakePrisma(baseSub()).prisma;
  });

  it("returns 503 when billing is not configured (no provider)", async () => {
    const app = buildServer({ prisma, billingProvider: undefined });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ id: "evt_1" }));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("service_unavailable");
  });

  it("rejects a request without the x-razorpay-signature header (400)", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: { razorpayWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-event-id", "evt_sub_1")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/x-razorpay-signature/i);
  });

  it("rejects a request without the x-razorpay-event-id header (400)", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: { razorpayWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "goodsig")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/x-razorpay-event-id/i);
  });

  it("rejects an invalid signature (400) and never processes the event", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => {
        throw new Error("Razorpay webhook signature verification failed.");
      }),
      services: { razorpayWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "badsig")
      .set("x-razorpay-event-id", "evt_sub_1")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/signature/i);
  });

  it("accepts a valid signature and returns the outcome (200)", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: { razorpayWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "goodsig")
      .set("x-razorpay-event-id", "evt_sub_1")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: "applied" });
  });

  it("returns 500 when processing throws so Razorpay retries", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: {
        razorpayWebhooks: {
          handleEvent: async () => {
            throw new Error("boom");
          },
        } as unknown as RazorpayWebhookService,
      },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "goodsig")
      .set("x-razorpay-event-id", "evt_sub_1")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(500);
  });
});
