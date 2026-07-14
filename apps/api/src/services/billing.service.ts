import { AppError } from "@backend-uptime/shared";
import type { BillingProvider } from "@backend-uptime/billing";
import type { PrismaClient, PlanTier, BillingProviderKind } from "@backend-uptime/db";
import type { AuditLogService } from "./audit-log.service.js";
import type { PlanLimitsService, PlanSummary } from "./plan-limits.service.js";

export interface BillingActor {
  userId: string | null;
  actorType: "user" | "api_key";
  email: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface PlanView {
  tier: PlanTier;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  monitorLimit: number | null;
  seatLimit: number | null;
  statusPageLimit: number | null;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  ssoEnabled: boolean;
  advancedAnalytics: boolean;
  /** Self-serve checkout is possible only when the active provider has a price/plan configured. */
  purchasable: boolean;
}

export interface InvoiceView {
  id: string;
  type: string;
  amountCents: number | null;
  currency: string | null;
  status: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  createdAt: Date;
}

export interface SubscriptionView {
  plan: PlanTier;
  status: string;
  seats: number;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: Date | null;
  hasBillingCustomer: boolean;
}

export interface BillingService {
  listPlans(): Promise<PlanView[]>;
  getSummary(organizationId: string): Promise<{ subscription: SubscriptionView; plan: PlanSummary }>;
  listInvoices(organizationId: string, limit: number): Promise<InvoiceView[]>;
  startCheckout(
    organizationId: string,
    input: { tier: PlanTier; quantity?: number },
    actor: BillingActor,
    orgName: string,
  ): Promise<{ url: string }>;
  openPortal(organizationId: string, actor: BillingActor): Promise<{ url: string }>;
  changePlan(organizationId: string, input: { tier: PlanTier; quantity?: number }, actor: BillingActor): Promise<void>;
  cancel(organizationId: string, input: { atPeriodEnd: boolean }, actor: BillingActor): Promise<void>;
}

export interface BillingServiceDeps {
  prisma: PrismaClient;
  plans: PlanLimitsService;
  /** Absent when billing is not configured — mutating actions then 503. */
  provider?: BillingProvider;
  /**
   * Which processor `provider` actually talks to. Drives which
   * plan/subscription columns get read and written (stripe* vs razorpay*),
   * so a switch of BILLING_PROVIDER doesn't require touching this file.
   */
  providerKind: BillingProviderKind;
  /** Public web origin for checkout success/cancel and portal return urls. */
  webUrl: string;
  auditLogs?: AuditLogService;
}

export function createBillingService(deps: BillingServiceDeps): BillingService {
  const { prisma, plans, provider, providerKind, auditLogs } = deps;
  const webUrl = deps.webUrl.replace(/\/$/, "");
  const billingUrl = `${webUrl}/dashboard/billing`;
  const isStripe = providerKind === "STRIPE";

  function requireProvider(): BillingProvider {
    if (!provider) {
      throw new AppError("service_unavailable", "Billing is not configured on this server.");
    }
    return provider;
  }

  async function planForTier(tier: PlanTier) {
    const plan = await prisma.billingPlan.findUnique({ where: { tier } });
    if (!plan) throw AppError.notFound(`Plan ${tier} does not exist.`);
    return plan;
  }

  /** The provider-side price/plan id for the active provider, or null if unset. */
  function planExternalId(plan: { stripePriceId: string | null; razorpayPlanId: string | null }): string | null {
    return isStripe ? plan.stripePriceId : plan.razorpayPlanId;
  }

  /** Reuse the org's provider customer id or create one and persist it. */
  async function ensureCustomer(organizationId: string, actor: BillingActor, orgName: string): Promise<string> {
    const sub = await prisma.subscription.findUnique({
      where: { organizationId },
      select: { stripeCustomerId: true, razorpayCustomerId: true, provider: true },
    });
    const existingId = isStripe ? sub?.stripeCustomerId : sub?.razorpayCustomerId;
    // Only reuse an existing customer id if it belongs to the currently
    // active provider — a subscription created under Stripe shouldn't have
    // its stale stripeCustomerId reused once BILLING_PROVIDER=razorpay.
    if (existingId && (!sub?.provider || sub.provider === providerKind)) return existingId;
    if (!actor.email) {
      throw new AppError("bad_request", "A billing email is required to start checkout.");
    }
    const customerId = await requireProvider().ensureCustomer({
      organizationId,
      email: actor.email,
      name: orgName,
    });
    await prisma.subscription.upsert({
      where: { organizationId },
      update: {
        provider: providerKind,
        ...(isStripe ? { stripeCustomerId: customerId } : { razorpayCustomerId: customerId }),
      },
      create: {
        organizationId,
        plan: "FREE",
        status: "INCOMPLETE",
        provider: providerKind,
        ...(isStripe ? { stripeCustomerId: customerId } : { razorpayCustomerId: customerId }),
      },
    });
    return customerId;
  }

  async function audit(action: string, organizationId: string, actor: BillingActor, metadata?: Record<string, unknown>): Promise<void> {
    await auditLogs?.log({
      organizationId,
      actorId: actor.userId,
      actorType: actor.actorType,
      action,
      resourceType: "billing",
      resourceId: organizationId,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
      metadata,
    });
  }

  return {
    async listPlans() {
      const rows = await prisma.billingPlan.findMany({
        where: { isPublic: true },
        orderBy: { sortOrder: "asc" },
      });
      return rows.map((p) => ({
        tier: p.tier,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        currency: p.currency,
        monitorLimit: p.monitorLimit,
        seatLimit: p.seatLimit,
        statusPageLimit: p.statusPageLimit,
        smsEnabled: p.smsEnabled,
        voiceEnabled: p.voiceEnabled,
        ssoEnabled: p.ssoEnabled,
        advancedAnalytics: p.advancedAnalytics,
        purchasable: Boolean(planExternalId(p)),
      }));
    },

    async getSummary(organizationId) {
      const sub = await prisma.subscription.findUnique({ where: { organizationId } });
      const planSummary = await plans.getSummary(organizationId);
      const subscription: SubscriptionView = {
        plan: sub?.plan ?? "FREE",
        status: sub?.status ?? "INCOMPLETE",
        seats: sub?.seats ?? 1,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
        canceledAt: sub?.canceledAt ?? null,
        hasBillingCustomer: Boolean(isStripe ? sub?.stripeCustomerId : sub?.razorpayCustomerId),
      };
      return { subscription, plan: planSummary };
    },

    async listInvoices(organizationId, limit) {
      const rows = await prisma.invoiceEvent.findMany({
        where: { organizationId, type: { in: ["PAYMENT_SUCCEEDED", "PAYMENT_FAILED"] } },
        orderBy: { createdAt: "desc" },
        take: limit,
      });
      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        amountCents: r.amountCents,
        currency: r.currency,
        status: r.status,
        hostedInvoiceUrl: r.hostedInvoiceUrl,
        invoicePdfUrl: r.invoicePdfUrl,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        createdAt: r.createdAt,
      }));
    },

    async startCheckout(organizationId, input, actor, orgName) {
      const billing = requireProvider();
      const plan = await planForTier(input.tier);
      const externalId = planExternalId(plan);
      if (!externalId) {
        throw new AppError("bad_request", `The ${plan.name} plan is not available for self-serve checkout.`);
      }
      const customerId = await ensureCustomer(organizationId, actor, orgName);
      const session = await billing.createCheckoutSession({
        organizationId,
        customerId,
        priceId: externalId,
        quantity: input.quantity,
        successUrl: `${billingUrl}?checkout=success`,
        cancelUrl: `${billingUrl}?checkout=canceled`,
      });
      if (!session.url) throw new AppError("service_unavailable", "The billing provider did not return a checkout url.");
      await audit("billing.checkout_started", organizationId, actor, { tier: input.tier, provider: providerKind });
      return { url: session.url };
    },

    async openPortal(organizationId, actor) {
      const billing = requireProvider();
      const sub = await prisma.subscription.findUnique({
        where: { organizationId },
        select: { stripeCustomerId: true, razorpayCustomerId: true },
      });
      const customerId = isStripe ? sub?.stripeCustomerId : sub?.razorpayCustomerId;
      if (!customerId) {
        throw new AppError("conflict", "No billing account yet — start a subscription first.");
      }
      // For Stripe this opens the real hosted Billing Portal; for Razorpay
      // (which has no equivalent) the provider returns our own in-app
      // "manage subscription" page url instead — see createRazorpayBillingProvider.
      const session = await billing.createPortalSession({ customerId, returnUrl: billingUrl });
      await audit("billing.portal_opened", organizationId, actor, { provider: providerKind });
      return { url: session.url };
    },

    async changePlan(organizationId, input, actor) {
      const billing = requireProvider();
      const plan = await planForTier(input.tier);
      const externalId = planExternalId(plan);
      if (!externalId) {
        throw new AppError("bad_request", `The ${plan.name} plan cannot be switched to via the API.`);
      }
      const sub = await prisma.subscription.findUnique({
        where: { organizationId },
        select: { stripeSubscriptionId: true, razorpaySubscriptionId: true },
      });
      const subscriptionId = isStripe ? sub?.stripeSubscriptionId : sub?.razorpaySubscriptionId;
      if (!subscriptionId) {
        throw new AppError("conflict", "No active subscription to change — start checkout instead.");
      }
      await billing.changePlan({
        subscriptionId,
        newPriceId: externalId,
        quantity: input.quantity,
      });
      await audit("billing.plan_changed", organizationId, actor, { tier: input.tier, provider: providerKind });
    },

    async cancel(organizationId, input, actor) {
      const billing = requireProvider();
      const sub = await prisma.subscription.findUnique({
        where: { organizationId },
        select: { stripeSubscriptionId: true, razorpaySubscriptionId: true },
      });
      const subscriptionId = isStripe ? sub?.stripeSubscriptionId : sub?.razorpaySubscriptionId;
      if (!subscriptionId) {
        throw new AppError("conflict", "No active subscription to cancel.");
      }
      await billing.cancelSubscription({ subscriptionId, atPeriodEnd: input.atPeriodEnd });
      await audit("billing.canceled", organizationId, actor, { atPeriodEnd: input.atPeriodEnd, provider: providerKind });
    },
  };
}
