import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createRazorpayBillingProvider,
  isHandledRazorpayEvent,
  HANDLED_RAZORPAY_EVENTS,
  type RazorpayLike,
} from "../src/index.js";

function fakeRazorpay(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = {
    customerCreate: vi.fn(async (p: unknown) => ({ id: "cust_123", ...(p as object) })),
    subCreate: vi.fn(async () => ({ id: "sub_test_1", short_url: "https://rzp.io/i/sub_test_1" })),
    subFetch: vi.fn(async (id: string) => ({ id, plan_id: "plan_old" })),
    subUpdate: vi.fn(async (id: string, p: unknown) => ({ id, ...(p as object) })),
    subCancel: vi.fn(async (id: string) => ({ id, status: "cancelled" })),
  };
  const razorpay = {
    customers: { create: calls.customerCreate },
    subscriptions: {
      create: calls.subCreate,
      fetch: calls.subFetch,
      update: calls.subUpdate,
      cancel: calls.subCancel,
    },
    ...overrides,
  } as unknown as RazorpayLike;
  return { razorpay, calls };
}

const DEPS_BASE = {
  webhookSecret: "whsec_test",
  checkoutBaseUrl: "https://app.test/dashboard/billing/checkout",
  portalUrl: "https://app.test/dashboard/billing/manage",
};

describe("RazorpayBillingProvider", () => {
  it("ensureCustomer stamps the org onto Razorpay notes", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    const id = await provider.ensureCustomer({ organizationId: "org_1", email: "a@b.co", name: "Acme" });
    expect(id).toBe("cust_123");
    expect(calls.customerCreate).toHaveBeenCalledWith({
      name: "Acme",
      email: "a@b.co",
      notes: { organizationId: "org_1" },
    });
  });

  it("createCheckoutSession creates a subscription and returns a checkout-page url with the id", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    const res = await provider.createCheckoutSession({
      organizationId: "org_1",
      customerId: "cust_123",
      priceId: "plan_growth_rzp",
      quantity: 3,
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });
    expect(res).toEqual({
      id: "sub_test_1",
      url: "https://app.test/dashboard/billing/checkout?subscription_id=sub_test_1",
    });
    expect(calls.subCreate).toHaveBeenCalledWith({
      plan_id: "plan_growth_rzp",
      customer_notify: 1,
      quantity: 3,
      total_count: 120,
      notes: { organizationId: "org_1", customerId: "cust_123" },
    });
  });

  it("createCheckoutSession defaults quantity to 1", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    await provider.createCheckoutSession({
      organizationId: "org_1",
      customerId: "cust_123",
      priceId: "plan_starter_rzp",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });
    const arg = calls.subCreate.mock.calls[0]![0] as unknown as Record<string, unknown>;
    expect(arg.quantity).toBe(1);
  });

  it("createPortalSession returns the in-app manage-subscription url (no Razorpay hosted portal)", async () => {
    const { razorpay } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    const res = await provider.createPortalSession({ customerId: "cust_123", returnUrl: "https://app/billing" });
    expect(res.url).toBe("https://app.test/dashboard/billing/manage");
  });

  it("changePlan updates the subscription's plan_id immediately", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    await provider.changePlan({ subscriptionId: "sub_1", newPriceId: "plan_business_rzp", quantity: 2 });
    expect(calls.subUpdate).toHaveBeenCalledWith("sub_1", {
      plan_id: "plan_business_rzp",
      quantity: 2,
      schedule_change_at: "now",
    });
  });

  it("cancelSubscription at period end sets cancel_at_cycle_end", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    await provider.cancelSubscription({ subscriptionId: "sub_1", atPeriodEnd: true });
    expect(calls.subCancel).toHaveBeenCalledWith("sub_1", { cancel_at_cycle_end: 1 });
  });

  it("cancelSubscription immediately sets cancel_at_cycle_end to 0", async () => {
    const { razorpay, calls } = fakeRazorpay();
    const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
    await provider.cancelSubscription({ subscriptionId: "sub_1", atPeriodEnd: false });
    expect(calls.subCancel).toHaveBeenCalledWith("sub_1", { cancel_at_cycle_end: 0 });
  });

  describe("verifyWebhook", () => {
    function sign(body: string, secret: string): string {
      return createHmac("sha256", secret).update(body).digest("hex");
    }

    it("verifies a correctly signed subscription payload and normalizes it", async () => {
      const { razorpay } = fakeRazorpay();
      const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
      const body = JSON.stringify({
        event: "subscription.activated",
        payload: { subscription: { entity: { id: "sub_1", status: "active" } } },
      });
      const sig = sign(body, DEPS_BASE.webhookSecret);
      const event = provider.verifyWebhook(body, sig, "evt_header_id_1");
      expect(event.id).toBe("evt_header_id_1");
      expect(event.type).toBe("subscription.activated");
      expect(event.data.object).toEqual({ id: "sub_1", status: "active" });
    });

    it("normalizes a payment.failed payload from payload.payment.entity", async () => {
      const { razorpay } = fakeRazorpay();
      const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
      const body = JSON.stringify({
        event: "payment.failed",
        payload: { payment: { entity: { id: "pay_1", status: "failed" } } },
      });
      const sig = sign(body, DEPS_BASE.webhookSecret);
      const event = provider.verifyWebhook(body, sig, "evt_header_id_2");
      expect(event.data.object).toEqual({ id: "pay_1", status: "failed" });
    });

    it("throws on an invalid signature", () => {
      const { razorpay } = fakeRazorpay();
      const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
      const body = JSON.stringify({ event: "subscription.activated", payload: {} });
      expect(() => provider.verifyWebhook(body, "not-the-right-signature", "evt_1")).toThrow(/signature/i);
    });

    it("throws when eventId is missing (idempotency would be unenforceable)", () => {
      const { razorpay } = fakeRazorpay();
      const provider = createRazorpayBillingProvider({ razorpay, ...DEPS_BASE });
      const body = JSON.stringify({ event: "subscription.activated", payload: {} });
      const sig = sign(body, DEPS_BASE.webhookSecret);
      expect(() => provider.verifyWebhook(body, sig)).toThrow(/event-id/i);
    });
  });
});

describe("handled razorpay events", () => {
  it("recognizes the expected subscription lifecycle events", () => {
    expect(HANDLED_RAZORPAY_EVENTS.length).toBeGreaterThan(0);
    expect(isHandledRazorpayEvent("subscription.charged")).toBe(true);
    expect(isHandledRazorpayEvent("subscription.activated")).toBe(true);
    expect(isHandledRazorpayEvent("refund.created")).toBe(false);
  });
});
