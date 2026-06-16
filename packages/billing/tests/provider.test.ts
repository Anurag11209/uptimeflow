import { describe, expect, it, vi } from "vitest";
import {
  createStripeBillingProvider,
  isHandledStripeEvent,
  HANDLED_STRIPE_EVENTS,
  type StripeLike,
} from "../src/index.js";

/** Build a fake StripeLike whose calls are recorded, so we can assert the
 *  wrapper maps inputs to the right Stripe params. */
function fakeStripe(overrides: Partial<Record<string, unknown>> = {}) {
  const calls = {
    customerCreate: vi.fn(async (p: unknown) => ({ id: "cus_123", ...(p as object) })),
    checkoutCreate: vi.fn(async () => ({ id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" })),
    portalCreate: vi.fn(async () => ({ url: "https://billing.stripe.com/p/session_1" })),
    subRetrieve: vi.fn(async (id: string) => ({ id, items: { data: [{ id: "si_1" }] } })),
    subUpdate: vi.fn(async (id: string, p: unknown) => ({ id, ...(p as object) })),
    subCancel: vi.fn(async (id: string) => ({ id, status: "canceled" })),
    constructEvent: vi.fn(() => ({ id: "evt_1", type: "checkout.session.completed" })),
  };
  const stripe = {
    customers: { create: calls.customerCreate },
    checkout: { sessions: { create: calls.checkoutCreate } },
    billingPortal: { sessions: { create: calls.portalCreate } },
    subscriptions: { retrieve: calls.subRetrieve, update: calls.subUpdate, cancel: calls.subCancel },
    webhooks: { constructEvent: calls.constructEvent },
    ...overrides,
  } as unknown as StripeLike;
  return { stripe, calls };
}

describe("StripeBillingProvider", () => {
  it("ensureCustomer stamps the org onto Stripe metadata", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    const id = await provider.ensureCustomer({ organizationId: "org_1", email: "a@b.co", name: "Acme" });
    expect(id).toBe("cus_123");
    expect(calls.customerCreate).toHaveBeenCalledWith({
      email: "a@b.co",
      name: "Acme",
      metadata: { organizationId: "org_1" },
    });
  });

  it("createCheckoutSession passes price, quantity, mode and urls", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    const res = await provider.createCheckoutSession({
      organizationId: "org_1",
      customerId: "cus_123",
      priceId: "price_growth",
      quantity: 3,
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });
    expect(res).toEqual({ id: "cs_test_1", url: "https://checkout.stripe.com/c/cs_test_1" });
    const arg = calls.checkoutCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.mode).toBe("subscription");
    expect(arg.customer).toBe("cus_123");
    expect(arg.line_items).toEqual([{ price: "price_growth", quantity: 3 }]);
    expect(arg.success_url).toBe("https://app/ok");
  });

  it("createCheckoutSession defaults quantity to 1", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    await provider.createCheckoutSession({
      organizationId: "org_1",
      customerId: "cus_123",
      priceId: "price_starter",
      successUrl: "https://app/ok",
      cancelUrl: "https://app/no",
    });
    const arg = calls.checkoutCreate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.line_items).toEqual([{ price: "price_starter", quantity: 1 }]);
  });

  it("createPortalSession returns the portal url", async () => {
    const { stripe } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    const res = await provider.createPortalSession({ customerId: "cus_123", returnUrl: "https://app/billing" });
    expect(res.url).toBe("https://billing.stripe.com/p/session_1");
  });

  it("changePlan swaps the subscription item to the new price", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    await provider.changePlan({ subscriptionId: "sub_1", newPriceId: "price_business", quantity: 2 });
    expect(calls.subRetrieve).toHaveBeenCalledWith("sub_1");
    const [id, params] = calls.subUpdate.mock.calls[0]! as [string, Record<string, unknown>];
    expect(id).toBe("sub_1");
    expect(params.items).toEqual([{ id: "si_1", price: "price_business", quantity: 2 }]);
    expect(params.proration_behavior).toBe("create_prorations");
    expect(params.cancel_at_period_end).toBe(false);
  });

  it("changePlan throws when the subscription has no line items", async () => {
    const { stripe } = fakeStripe({
      subscriptions: {
        retrieve: async (id: string) => ({ id, items: { data: [] } }),
        update: async () => ({}),
        cancel: async () => ({}),
      } as unknown,
    });
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    await expect(provider.changePlan({ subscriptionId: "sub_1", newPriceId: "p" })).rejects.toThrow(/no line items/);
  });

  it("cancelSubscription at period end updates cancel_at_period_end", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    await provider.cancelSubscription({ subscriptionId: "sub_1", atPeriodEnd: true });
    expect(calls.subUpdate).toHaveBeenCalledWith("sub_1", { cancel_at_period_end: true });
    expect(calls.subCancel).not.toHaveBeenCalled();
  });

  it("cancelSubscription immediately calls subscriptions.cancel", async () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_x" });
    await provider.cancelSubscription({ subscriptionId: "sub_1", atPeriodEnd: false });
    expect(calls.subCancel).toHaveBeenCalledWith("sub_1");
    expect(calls.subUpdate).not.toHaveBeenCalled();
  });

  it("verifyWebhook delegates to constructEvent with the configured secret", () => {
    const { stripe, calls } = fakeStripe();
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_secret" });
    const event = provider.verifyWebhook("raw-body", "sig-header");
    expect(event.id).toBe("evt_1");
    expect(calls.constructEvent).toHaveBeenCalledWith("raw-body", "sig-header", "whsec_secret");
  });

  it("verifyWebhook surfaces signature failures", () => {
    const { stripe } = fakeStripe({
      webhooks: {
        constructEvent: () => {
          throw new Error("No signatures found matching the expected signature");
        },
      },
    });
    const provider = createStripeBillingProvider({ stripe, webhookSecret: "whsec_secret" });
    expect(() => provider.verifyWebhook("raw", "bad")).toThrow(/signature/i);
  });
});

describe("handled events", () => {
  it("recognizes exactly the six billing events", () => {
    expect(HANDLED_STRIPE_EVENTS).toHaveLength(6);
    expect(isHandledStripeEvent("invoice.payment_failed")).toBe(true);
    expect(isHandledStripeEvent("customer.subscription.created")).toBe(true);
    expect(isHandledStripeEvent("charge.refunded")).toBe(false);
  });
});
