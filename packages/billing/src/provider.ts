import Stripe from "stripe";

/**
 * The minimal slice of the Stripe SDK this wrapper touches. The real
 * `Stripe` instance satisfies it structurally; unit tests pass a hand-written
 * fake (cast through `unknown`), so the provider is testable without network
 * or API keys — the same dependency-injection seam the rest of the codebase
 * uses for Prisma and queues.
 */
export interface StripeLike {
  customers: {
    create(params: Stripe.CustomerCreateParams): Promise<Stripe.Customer>;
  };
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<Stripe.Checkout.Session>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: Stripe.BillingPortal.SessionCreateParams): Promise<Stripe.BillingPortal.Session>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<Stripe.Subscription>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<Stripe.Subscription>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<Stripe.Subscription>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, header: string, secret: string): Stripe.Event;
  };
}

export interface EnsureCustomerInput {
  /** Tenant the customer belongs to — stored in Stripe metadata for webhook routing. */
  organizationId: string;
  email: string;
  name?: string;
}

export interface CheckoutSessionInput {
  organizationId: string;
  customerId: string;
  priceId: string;
  /** Number of seats / licensed quantity. Defaults to 1. */
  quantity?: number;
  successUrl: string;
  cancelUrl: string;
}

export interface PortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface ChangePlanInput {
  subscriptionId: string;
  newPriceId: string;
  quantity?: number;
  /** Stripe proration behavior; defaults to "create_prorations". */
  prorationBehavior?: Stripe.SubscriptionUpdateParams.ProrationBehavior;
}

export interface CancelInput {
  subscriptionId: string;
  /** true = cancel at period end (keep access until paid period ends); false = immediate. */
  atPeriodEnd: boolean;
}

/**
 * Thin, provider-agnostic billing surface. Every method maps to one Stripe
 * call and returns plain data — no Stripe objects leak past this boundary
 * except the verified webhook `Event`, which the webhook route needs whole.
 */
export interface BillingProvider {
  /** Idempotently create a Stripe customer for the org; returns the customer id. */
  ensureCustomer(input: EnsureCustomerInput): Promise<string>;
  /** Start a subscription Checkout; returns the hosted session id + redirect url. */
  createCheckoutSession(input: CheckoutSessionInput): Promise<{ id: string; url: string | null }>;
  /** Open the Stripe billing portal (manage payment method, invoices). */
  createPortalSession(input: PortalSessionInput): Promise<{ url: string }>;
  /** Upgrade/downgrade: swap the subscription's item to a new price in place. */
  changePlan(input: ChangePlanInput): Promise<void>;
  /** Cancel a subscription, immediately or at period end. */
  cancelSubscription(input: CancelInput): Promise<void>;
  /** Verify a webhook signature and return the parsed event (throws on bad sig). */
  verifyWebhook(payload: string | Buffer, signature: string): Stripe.Event;
}

export interface StripeProviderDeps {
  stripe: StripeLike;
  /** STRIPE_WEBHOOK_SECRET — required to verify inbound webhook signatures. */
  webhookSecret: string;
}

export function createStripeBillingProvider(deps: StripeProviderDeps): BillingProvider {
  const { stripe, webhookSecret } = deps;

  return {
    async ensureCustomer(input) {
      const customer = await stripe.customers.create({
        email: input.email,
        name: input.name,
        metadata: { organizationId: input.organizationId },
      });
      return customer.id;
    },

    async createCheckoutSession(input) {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: input.quantity ?? 1 }],
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        // Echo the org onto the subscription so webhooks can resolve the tenant
        // even if the customer metadata is ever missing.
        subscription_data: { metadata: { organizationId: input.organizationId } },
        metadata: { organizationId: input.organizationId },
      });
      return { id: session.id, url: session.url };
    },

    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },

    async changePlan(input) {
      // Stripe changes the price by updating the subscription's first item, not
      // the subscription directly, so retrieve it to find the item id.
      const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
      const itemId = subscription.items.data[0]?.id;
      if (!itemId) {
        throw new Error(`Subscription ${input.subscriptionId} has no line items to update.`);
      }
      await stripe.subscriptions.update(input.subscriptionId, {
        items: [{ id: itemId, price: input.newPriceId, quantity: input.quantity }],
        proration_behavior: input.prorationBehavior ?? "create_prorations",
        cancel_at_period_end: false,
      });
    },

    async cancelSubscription(input) {
      if (input.atPeriodEnd) {
        await stripe.subscriptions.update(input.subscriptionId, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.cancel(input.subscriptionId);
      }
    },

    verifyWebhook(payload, signature) {
      return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    },
  };
}

/** Construct a real Stripe client. `apiVersion` is omitted so the SDK uses its
 *  pinned version (and the account default), avoiding a hardcoded date string. */
export function createStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey);
}
