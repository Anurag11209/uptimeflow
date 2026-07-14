import {
  Prisma,
  type PrismaClient,
  type InvoiceEventType,
  type SubscriptionStatus,
  type PlanTier,
} from "@backend-uptime/db";
import { isHandledRazorpayEvent } from "@backend-uptime/billing";
import type { AuditLogService } from "./audit-log.service.js";
import type { Logger } from "../telemetry.js";
import type { WebhookOutcome } from "./billing-webhook.service.js";

/**
 * Structural view of the entity we read off a Razorpay webhook payload
 * (already normalized to `{ id, type, data: { object } }` by
 * `RazorpayBillingProvider.verifyWebhook`). `data.object` is either the
 * `subscription.entity` or `payment.entity`, depending on event type — see
 * that provider for the normalization.
 */
export interface RazorpayEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export interface RazorpayWebhookService {
  /**
   * Apply one verified Razorpay event. Idempotent: the unique InvoiceEvent
   * providerEventId (sourced from the x-razorpay-event-id header) means a
   * replayed event is recorded once and its effect applied once.
   */
  handleEvent(event: RazorpayEventLike): Promise<WebhookOutcome>;
}

// ── Razorpay → domain mappings ──────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, InvoiceEventType> = {
  "subscription.authenticated": "SUBSCRIPTION_CREATED",
  "subscription.activated": "CHECKOUT_COMPLETED",
  "subscription.charged": "PAYMENT_SUCCEEDED",
  "subscription.updated": "SUBSCRIPTION_UPDATED",
  "subscription.pending": "SUBSCRIPTION_UPDATED",
  "subscription.halted": "PAYMENT_FAILED",
  "subscription.cancelled": "SUBSCRIPTION_DELETED",
  "subscription.completed": "SUBSCRIPTION_DELETED",
  "payment.failed": "PAYMENT_FAILED",
};

/**
 * Razorpay subscription statuses: created, authenticated, active, pending,
 * halted, cancelled, completed, expired. Mapped onto our provider-neutral
 * SubscriptionStatus enum; "pending" and "halted" both mean a charge attempt
 * failed and Razorpay is retrying, which is the same user-facing state as
 * Stripe's "past_due".
 */
function mapStatus(razorpayStatus: string | undefined): SubscriptionStatus {
  switch (razorpayStatus) {
    case "authenticated":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "pending":
    case "halted":
      return "PAST_DUE";
    case "cancelled":
      return "CANCELED";
    case "expired":
      return "UNPAID";
    case "created":
    default:
      return "INCOMPLETE";
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function unixToDate(v: unknown): Date | null {
  const n = num(v);
  return n === null ? null : new Date(n * 1000);
}
function metaOrg(object: Record<string, unknown>): string | null {
  // We pass organizationId in `notes` on subscription creation (see
  // RazorpayBillingProvider.createCheckoutSession) — Razorpay's equivalent
  // of Stripe metadata.
  const notes = object.notes;
  if (notes && typeof notes === "object" && "organizationId" in notes) {
    return str((notes as Record<string, unknown>).organizationId);
  }
  return null;
}

export function createRazorpayWebhookService(deps: {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  logger?: Logger;
}): RazorpayWebhookService {
  const { prisma, auditLogs, logger } = deps;

  async function resolveOrgId(
    tx: Prisma.TransactionClient,
    object: Record<string, unknown>,
    customerId: string | null,
    subscriptionId: string | null,
  ): Promise<string | null> {
    const fromNotes = metaOrg(object);
    if (fromNotes) return fromNotes;
    if (subscriptionId) {
      const sub = await tx.subscription.findFirst({
        where: { provider: "RAZORPAY", razorpaySubscriptionId: subscriptionId },
        select: { organizationId: true },
      });
      if (sub) return sub.organizationId;
    }
    if (!customerId) return null;
    const sub = await tx.subscription.findFirst({
      where: { provider: "RAZORPAY", razorpayCustomerId: customerId },
      select: { organizationId: true },
    });
    return sub?.organizationId ?? null;
  }

  async function applySubscription(
    tx: Prisma.TransactionClient,
    organizationId: string,
    sub: Record<string, unknown>,
  ): Promise<void> {
    const planId = str(sub.plan_id);
    const plan = planId
      ? await tx.billingPlan.findFirst({ where: { razorpayPlanId: planId }, select: { id: true, tier: true } })
      : null;
    const status = mapStatus(str(sub.status) ?? undefined);
    const customerId = str(sub.customer_id);
    const subId = str(sub.id);
    const cancelAtPeriodEnd = sub.cancel_at_cycle_end === true || sub.cancel_at_cycle_end === 1;
    const currentPeriodEnd = unixToDate(sub.current_end);
    const quantity = num(sub.quantity);

    const common = {
      status,
      cancelAtPeriodEnd,
      provider: "RAZORPAY" as const,
      ...(customerId ? { razorpayCustomerId: customerId } : {}),
      ...(subId ? { razorpaySubscriptionId: subId } : {}),
      ...(planId ? { razorpayPlanId: planId } : {}),
      ...(plan ? { planId: plan.id, plan: plan.tier as PlanTier } : {}),
      ...(quantity !== null ? { seats: quantity } : {}),
      ...(currentPeriodEnd ? { currentPeriodEnd } : {}),
    };

    await tx.subscription.upsert({
      where: { organizationId },
      update: common,
      create: {
        organizationId,
        plan: (plan?.tier as PlanTier) ?? "FREE",
        ...common,
      },
    });
  }

  async function applyCancellation(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
    const free = await tx.billingPlan.findUnique({ where: { tier: "FREE" }, select: { id: true } });
    await tx.subscription.updateMany({
      where: { organizationId },
      data: {
        status: "CANCELED",
        plan: "FREE",
        planId: free?.id ?? null,
        razorpaySubscriptionId: null,
        razorpayPlanId: null,
        cancelAtPeriodEnd: false,
        canceledAt: new Date(),
      },
    });
  }

  return {
    async handleEvent(event) {
      if (!isHandledRazorpayEvent(event.type)) {
        logger?.info({ razorpayEventId: event.id, type: event.type }, "razorpay event ignored");
        return "ignored";
      }

      const object = event.data.object;
      const type = EVENT_TYPE_MAP[event.type]!;
      const isPaymentEntity = event.type === "payment.failed";
      // For subscription.* events, object is the subscription entity itself
      // and carries its own id/customer_id. For payment.failed, object is
      // the payment entity, which references the subscription separately.
      const subscriptionId = isPaymentEntity ? str(object.subscription_id) : str(object.id);
      const customerId = str(object.customer_id);

      try {
        const outcome = await prisma.$transaction(async (tx) => {
          const organizationId = await resolveOrgId(tx, object, customerId, subscriptionId);
          if (!organizationId) {
            logger?.warn({ razorpayEventId: event.id, type: event.type }, "razorpay event: org unresolved");
            return "ignored" as const;
          }

          const sub = await tx.subscription.findUnique({
            where: { organizationId },
            select: { id: true },
          });

          // Idempotency anchor: unique providerEventId (x-razorpay-event-id).
          await tx.invoiceEvent.create({
            data: {
              organizationId,
              subscriptionId: sub?.id ?? null,
              provider: "RAZORPAY",
              providerEventId: event.id,
              type,
              razorpayInvoiceId: null,
              razorpayPaymentId: isPaymentEntity ? str(object.id) : null,
              amountCents: isPaymentEntity ? num(object.amount) : null,
              currency: isPaymentEntity ? str(object.currency) : null,
              status: str(object.status),
              periodStart: !isPaymentEntity ? unixToDate(object.current_start) : null,
              periodEnd: !isPaymentEntity ? unixToDate(object.current_end) : null,
              payload: event as unknown as Prisma.InputJsonValue,
            },
          });

          switch (event.type) {
            case "subscription.authenticated":
            case "subscription.activated":
            case "subscription.updated":
            case "subscription.pending":
              await applySubscription(tx, organizationId, object);
              break;
            case "subscription.charged":
              await applySubscription(tx, organizationId, object);
              await tx.subscription.updateMany({ where: { organizationId }, data: { status: "ACTIVE" } });
              break;
            case "subscription.halted":
              await tx.subscription.updateMany({ where: { organizationId }, data: { status: "PAST_DUE" } });
              break;
            case "subscription.cancelled":
            case "subscription.completed":
              await applyCancellation(tx, organizationId);
              break;
            case "payment.failed":
              await tx.subscription.updateMany({ where: { organizationId }, data: { status: "PAST_DUE" } });
              break;
          }

          return { organizationId } as const;
        });

        if (outcome === "ignored") return "ignored";

        await auditLogs?.log({
          organizationId: outcome.organizationId,
          actorId: null,
          actorType: "system",
          action: `billing.${type.toLowerCase()}`,
          resourceType: "billing",
          resourceId: event.id,
          metadata: { razorpayEventType: event.type },
        });
        return "applied";
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          logger?.info({ razorpayEventId: event.id, type: event.type }, "razorpay event: duplicate, skipped");
          return "duplicate";
        }
        throw err;
      }
    },
  };
}
