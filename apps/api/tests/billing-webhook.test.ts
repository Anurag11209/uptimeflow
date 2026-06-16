import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { Prisma, type PrismaClient } from "@backend-uptime/db";
import type { BillingProvider } from "@backend-uptime/billing";
import {
  createBillingWebhookService,
  type StripeEventLike,
} from "../src/services/billing-webhook.service.js";
import type { BillingWebhookService } from "../src/services/billing-webhook.service.js";
import { buildServer } from "./helpers.js";

const WEBHOOK_PATH = "/v1/billing/webhooks/stripe";

// ── Stateful in-memory Prisma fake (subscriptions + invoice_events) ──────────

interface SubRow {
  id: string;
  organizationId: string;
  plan: string;
  status: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripePriceId?: string | null;
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
    { id: "plan_growth", tier: "GROWTH", stripePriceId: "price_growth" },
    { id: "plan_free", tier: "FREE", stripePriceId: null },
  ];

  const tx = {
    subscription: {
      findFirst: async ({ where }: { where: { stripeCustomerId?: string } }) => {
        for (const s of subs.values()) {
          if (where.stripeCustomerId && s.stripeCustomerId === where.stripeCustomerId) return s;
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
        const row: SubRow = { id: `sub_${where.organizationId}`, ...create };
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
      findFirst: async ({ where }: { where: { stripePriceId?: string } }) =>
        plans.find((p) => p.stripePriceId === where.stripePriceId) ?? null,
      findUnique: async ({ where }: { where: { tier?: string } }) =>
        plans.find((p) => p.tier === where.tier) ?? null,
    },
    invoiceEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const eid = data.stripeEventId as string;
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
    stripeCustomerId: "cus_1",
  };
}

function subscriptionEvent(overrides: Partial<StripeEventLike> = {}): StripeEventLike {
  return {
    id: "evt_sub_1",
    type: "customer.subscription.updated",
    data: {
      object: {
        id: "sub_x",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        current_period_end: 1893456000,
        metadata: { organizationId: "org_1" },
        items: { data: [{ price: { id: "price_growth" }, quantity: 3 }] },
      },
    },
    ...overrides,
  };
}

// ── Service: idempotency + per-event effects ─────────────────────────────────

describe("billing webhook service", () => {
  let svc: BillingWebhookService;
  let store: ReturnType<typeof makeFakePrisma>;

  function build(initial?: SubRow) {
    store = makeFakePrisma(initial);
    svc = createBillingWebhookService({ prisma: store.prisma });
  }

  it("applies a subscription.updated event: plan, status, seats", async () => {
    build(baseSub());
    const outcome = await svc.handleEvent(subscriptionEvent());
    expect(outcome).toBe("applied");
    const sub = store.subs.get("org_1")!;
    expect(sub.plan).toBe("GROWTH");
    expect(sub.planId).toBe("plan_growth");
    expect(sub.status).toBe("ACTIVE");
    expect(sub.seats).toBe(3);
    expect(sub.stripeSubscriptionId).toBe("sub_x");
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

  it("payment_failed marks the subscription PAST_DUE and records a ledger row", async () => {
    build(baseSub());
    const outcome = await svc.handleEvent({
      id: "evt_pf_1",
      type: "invoice.payment_failed",
      data: {
        object: { id: "in_1", customer: "cus_1", amount_due: 9900, currency: "usd", status: "open" },
      },
    });
    expect(outcome).toBe("applied");
    expect(store.subs.get("org_1")!.status).toBe("PAST_DUE");
    const row = store.invoiceRows[0]!;
    expect(row.type).toBe("PAYMENT_FAILED");
    expect(row.amountCents).toBe(9900);
    expect(row.stripeInvoiceId).toBe("in_1");
  });

  it("payment_succeeded marks ACTIVE and captures the hosted invoice url", async () => {
    build({ ...baseSub(), status: "PAST_DUE" });
    const outcome = await svc.handleEvent({
      id: "evt_ps_1",
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_2",
          customer: "cus_1",
          amount_paid: 9900,
          currency: "usd",
          status: "paid",
          hosted_invoice_url: "https://invoice.stripe.com/i/in_2",
        },
      },
    });
    expect(outcome).toBe("applied");
    expect(store.subs.get("org_1")!.status).toBe("ACTIVE");
    expect(store.invoiceRows[0]!.hostedInvoiceUrl).toBe("https://invoice.stripe.com/i/in_2");
  });

  it("subscription.deleted reverts the org to the FREE plan", async () => {
    build({ ...baseSub(), plan: "GROWTH", planId: "plan_growth", status: "ACTIVE", stripeSubscriptionId: "sub_x" });
    const outcome = await svc.handleEvent({
      id: "evt_del_1",
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_x", customer: "cus_1", status: "canceled" } },
    });
    expect(outcome).toBe("applied");
    const sub = store.subs.get("org_1")!;
    expect(sub.status).toBe("CANCELED");
    expect(sub.plan).toBe("FREE");
    expect(sub.planId).toBe("plan_free");
    expect(sub.stripeSubscriptionId).toBeNull();
  });

  it("ignores events outside the handled set", async () => {
    build(baseSub());
    const outcome = await svc.handleEvent({
      id: "evt_x",
      type: "charge.refunded",
      data: { object: {} },
    });
    expect(outcome).toBe("ignored");
    expect(store.events.size).toBe(0);
  });

  it("ignores events that cannot be attributed to an org", async () => {
    build(); // no subscription, so cus_unknown maps to nothing
    const outcome = await svc.handleEvent({
      id: "evt_orphan",
      type: "invoice.payment_succeeded",
      data: { object: { id: "in_9", customer: "cus_unknown" } },
    });
    expect(outcome).toBe("ignored");
    expect(store.events.size).toBe(0);
  });
});

// ── Route: signature verification + availability ─────────────────────────────

const okEvent: StripeEventLike = subscriptionEvent();

const fakeProvider = (verify: () => unknown): BillingProvider =>
  ({
    verifyWebhook: verify,
  }) as unknown as BillingProvider;

const fakeService = (outcome: string): BillingWebhookService =>
  ({ handleEvent: async () => outcome }) as unknown as BillingWebhookService;

describe("billing webhook route", () => {
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

  it("rejects a request without the stripe-signature header (400)", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: { billingWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/stripe-signature/i);
  });

  it("rejects an invalid signature (400) and never processes the event", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => {
        throw new Error("No signatures found matching the expected signature for payload");
      }),
      services: { billingWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=bad")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/signature/i);
  });

  it("accepts a valid signature and returns the outcome (200)", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: { billingWebhooks: fakeService("applied") },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=good")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, outcome: "applied" });
  });

  it("returns 500 when processing throws so Stripe retries", async () => {
    const app = buildServer({
      prisma,
      billingProvider: fakeProvider(() => okEvent),
      services: {
        billingWebhooks: {
          handleEvent: async () => {
            throw new Error("boom");
          },
        } as unknown as BillingWebhookService,
      },
    });
    const res = await request(app)
      .post(WEBHOOK_PATH)
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=good")
      .send(JSON.stringify(okEvent));
    expect(res.status).toBe(500);
  });
});
