import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  BillingProvider,
  CancelInput,
  ChangePlanInput,
  CheckoutSessionInput,
  EnsureCustomerInput,
  PortalSessionInput,
  ProviderEventLike,
} from "./provider.js";

/**
 * The minimal slice of the Razorpay Node SDK this wrapper touches. The real
 * `Razorpay` instance satisfies it structurally; unit tests pass a
 * hand-written fake (cast through `unknown`), mirroring the `StripeLike` seam
 * in provider.ts.
 *
 * Razorpay has no direct equivalent of a few Stripe concepts:
 *  - No product/price split — a `Plan` bundles both, referenced by planId.
 *  - No hosted Checkout redirect — Checkout.js is a client-side overlay
 *    keyed off a subscription id, so `createCheckoutSession` here just
 *    creates the Subscription and hands back a URL to our own page that
 *    boots Checkout.js with that id (see apps/web billing page).
 *  - No hosted customer Billing Portal — `createPortalSession` returns our
 *    own in-app "manage subscription" route instead of a Razorpay-hosted url.
 */
export interface RazorpayLike {
  customers: {
    create(params: { name?: string; email: string; notes?: Record<string, string> }): Promise<{ id: string }>;
  };
  subscriptions: {
    create(params: {
      plan_id: string;
      customer_notify?: 0 | 1;
      quantity?: number;
      total_count?: number;
      notes?: Record<string, string>;
    }): Promise<{ id: string; short_url?: string }>;
    fetch(id: string): Promise<{ id: string; plan_id?: string }>;
    update(id: string, params: { plan_id?: string; quantity?: number; schedule_change_at?: "now" | "cycle_end" }): Promise<unknown>;
    cancel(id: string, params?: { cancel_at_cycle_end?: 0 | 1 }): Promise<unknown>;
  };
}

export interface RazorpayEventLike {
  event: string;
  payload: Record<string, unknown>;
}

export interface RazorpayProviderDeps {
  razorpay: RazorpayLike;
  /** RAZORPAY_WEBHOOK_SECRET — used to compute the HMAC-SHA256 signature. */
  webhookSecret: string;
  /**
   * Where the frontend's checkout page lives, e.g. `${webUrl}/dashboard/billing/checkout`.
   * The subscription id is appended as a query param so the page can boot
   * Checkout.js with it: `?subscription_id=sub_xxx`.
   */
  checkoutBaseUrl: string;
  /** Our own manage-subscription page, since Razorpay has no hosted portal. */
  portalUrl: string;
}

/**
 * Thin, provider-agnostic billing surface backed by Razorpay Subscriptions.
 * Same shape as `createStripeBillingProvider` so the rest of the app (billing
 * service, webhook route) never branches on which provider is active.
 */
export function createRazorpayBillingProvider(deps: RazorpayProviderDeps): BillingProvider {
  const { razorpay, webhookSecret, checkoutBaseUrl, portalUrl } = deps;

  return {
    async ensureCustomer(input: EnsureCustomerInput) {
      // Razorpay's customer.create is idempotent per (email) only when
      // `fail_existing: 0` is passed; we rely on the caller (billing.service)
      // to persist and reuse the id instead of relying on Razorpay dedupe.
      const customer = await razorpay.customers.create({
        name: input.name,
        email: input.email,
        notes: { organizationId: input.organizationId },
      });
      return customer.id;
    },

    async createCheckoutSession(input: CheckoutSessionInput) {
      // Razorpay Subscriptions has no notion of a customer-scoped checkout
      // session — a Subscription is created directly against a plan, and
      // Checkout.js is opened client-side against its id. `total_count` is
      // required by the API; a large value approximates "until canceled"
      // (Stripe's default), renewing monthly for ~10 years.
      const subscription = await razorpay.subscriptions.create({
        plan_id: input.priceId,
        customer_notify: 1,
        quantity: input.quantity ?? 1,
        total_count: 120,
        notes: { organizationId: input.organizationId, customerId: input.customerId },
      });
      const url = `${checkoutBaseUrl}?subscription_id=${encodeURIComponent(subscription.id)}`;
      return { id: subscription.id, url };
    },

    async createPortalSession(_input: PortalSessionInput) {
      // No Razorpay-hosted equivalent to Stripe's Billing Portal; point at
      // our own in-app subscription management page instead.
      return { url: portalUrl };
    },

    async changePlan(input: ChangePlanInput) {
      // Razorpay swaps the plan on the subscription directly (no separate
      // "item" to update, unlike Stripe). `schedule_change_at: "now"` mirrors
      // Stripe's default `create_prorations` proration behavior by applying
      // the change immediately rather than at the next cycle.
      await razorpay.subscriptions.update(input.subscriptionId, {
        plan_id: input.newPriceId,
        quantity: input.quantity,
        schedule_change_at: "now",
      });
    },

    async cancelSubscription(input: CancelInput) {
      await razorpay.subscriptions.cancel(input.subscriptionId, {
        cancel_at_cycle_end: input.atPeriodEnd ? 1 : 0,
      });
    },

    verifyWebhook(payload: string | Buffer, signature: string, eventId?: string): ProviderEventLike {
      // Razorpay signs the RAW request body with HMAC-SHA256 keyed by the
      // webhook secret, sent in the `X-Razorpay-Signature` header — there is
      // no SDK call needed to verify (unlike Stripe's `constructEvent`), but
      // we must compare digests in constant time to avoid a timing attack,
      // and the body must not have been JSON-parsed/re-serialized before
      // this runs (re-encoding can change byte-for-byte content and break
      // the signature match).
      const body = typeof payload === "string" ? payload : payload.toString("utf8");
      const expected = createHmac("sha256", webhookSecret).update(body).digest("hex");

      const expectedBuf = Buffer.from(expected, "utf8");
      const actualBuf = Buffer.from(signature, "utf8");
      const valid = expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
      if (!valid) {
        throw new Error("Razorpay webhook signature verification failed.");
      }

      const parsed = JSON.parse(body) as RazorpayEventLike;

      // Razorpay's payload doesn't have a single `.data.object` — depending
      // on event type, the entity lives under payload.subscription.entity or
      // payload.payment.entity. Normalize to whichever is present so the
      // webhook service can read a consistent shape.
      const entity =
        (parsed.payload.subscription as { entity?: Record<string, unknown> } | undefined)?.entity ??
        (parsed.payload.payment as { entity?: Record<string, unknown> } | undefined)?.entity ??
        {};

      if (!eventId) {
        // Should never happen in production — the route always forwards the
        // x-razorpay-event-id header — but fail loudly rather than silently
        // breaking idempotency if it's ever missing.
        throw new Error("Razorpay webhook missing x-razorpay-event-id header; cannot guarantee idempotency.");
      }

      return {
        id: eventId,
        type: parsed.event,
        data: { object: entity },
      };
    },
  };
}

/** Construct a real Razorpay client. Lazily imported so `stripe`-only
 *  deployments don't need the `razorpay` package installed at runtime. */
export async function createRazorpayClient(keyId: string, keySecret: string): Promise<RazorpayLike> {
  const { default: Razorpay } = await import("razorpay");
  return new Razorpay({ key_id: keyId, key_secret: keySecret }) as unknown as RazorpayLike;
}
