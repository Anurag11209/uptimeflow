import {
  Prisma,
  type PrismaClient,
  type InvoiceEventType,
  type SubscriptionStatus,
  type PlanTier,
} from "@backend-uptime/db";
import { isHandledStripeEvent } from "@backend-uptime/billing";
import type { AuditLogService } from "./audit-log.service.js";
import type { Logger } from "../telemetry.js";

/**
 * Structural view of the slices of Stripe objects we read. Kept local (instead
 * of importing the full versioned Stripe types) so the service is driven by
 * plain objects in tests and is resilient to SDK field churn.
 */
export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type WebhookOutcome = "applied" | "duplicate" | "ignored";

export interface BillingWebhookService {
  /**
   * Apply one verified Stripe event. Idempotent: the unique InvoiceEvent
   * stripeEventId means a replayed event is recorded once and its effect
   * applied once — a second delivery returns "duplicate" without re-applying.
   */
  handleEvent(event: StripeEventLike): Promise<WebhookOutcome>;
}

// ── Stripe → domain mappings ────────────────────────────────────────────────

const EVENT_TYPE_MAP: Record<string, InvoiceEventType> = {
  "checkout.session.completed": "CHECKOUT_COMPLETED",
  "customer.subscription.created": "SUBSCRIPTION_CREATED",
  "customer.subscription.updated": "SUBSCRIPTION_UPDATED",
  "customer.subscription.deleted": "SUBSCRIPTION_DELETED",
  "invoice.payment_succeeded": "PAYMENT_SUCCEEDED",
  "invoice.payment_failed": "PAYMENT_FAILED",
};

function mapStatus(stripeStatus: string | undefined): SubscriptionStatus {
  switch (stripeStatus) {
    case "trialing":
      return "TRIALING";
    case "active":
      return "ACTIVE";
    case "past_due":
    case "paused":
      return "PAST_DUE";
    case "canceled":
      return "CANCELED";
    case "unpaid":
      return "UNPAID";
    case "incomplete":
    case "incomplete_expired":
    default:
      return "INCOMPLETE";
  }
}

// ── Defensive field extractors (Stripe sends unix seconds, snake_case) ───────

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
  const meta = object.metadata;
  if (meta && typeof meta === "object" && "organizationId" in meta) {
    return str((meta as Record<string, unknown>).organizationId);
  }
  return null;
}

interface SubItem {
  priceId: string | null;
  quantity: number | null;
  periodEnd: Date | null;
}
function firstItem(object: Record<string, unknown>): SubItem {
  const items = object.items as { data?: unknown[] } | undefined;
  const first = (items?.data?.[0] ?? {}) as Record<string, unknown>;
  const price = first.price as Record<string, unknown> | undefined;
  return {
    priceId: str(price?.id),
    quantity: num(first.quantity),
    periodEnd: unixToDate(first.current_period_end),
  };
}

export function createBillingWebhookService(deps: {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  logger?: Logger;
}): BillingWebhookService {
  const { prisma, auditLogs, logger } = deps;

  /** Resolve the tenant: prefer event metadata, fall back to the customer map. */
  async function resolveOrgId(
    tx: Prisma.TransactionClient,
    object: Record<string, unknown>,
    customerId: string | null,
  ): Promise<string | null> {
    const fromMeta = metaOrg(object);
    if (fromMeta) return fromMeta;
    if (!customerId) return null;
    const sub = await tx.subscription.findFirst({
      where: { stripeCustomerId: customerId },
      select: { organizationId: true },
    });
    return sub?.organizationId ?? null;
  }

  /** Upsert the org's subscription from a Stripe subscription object. */
  async function applySubscription(
    tx: Prisma.TransactionClient,
    organizationId: string,
    sub: Record<string, unknown>,
  ): Promise<void> {
    const { priceId, quantity, periodEnd } = firstItem(sub);
    const plan = priceId
      ? await tx.billingPlan.findFirst({ where: { stripePriceId: priceId }, select: { id: true, tier: true } })
      : null;
    const status = mapStatus(str(sub.status) ?? undefined);
    const customerId = str(sub.customer);
    const subId = str(sub.id);
    const cancelAtPeriodEnd = sub.cancel_at_period_end === true;
    const canceledAt = unixToDate(sub.canceled_at);
    const currentPeriodEnd = unixToDate(sub.current_period_end) ?? periodEnd;

    const common = {
      status,
      cancelAtPeriodEnd,
      canceledAt,
      ...(customerId ? { stripeCustomerId: customerId } : {}),
      ...(subId ? { stripeSubscriptionId: subId } : {}),
      ...(priceId ? { stripePriceId: priceId } : {}),
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

  /** On subscription deletion, drop the org back to the FREE catalog plan. */
  async function applyCancellation(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const free = await tx.billingPlan.findUnique({ where: { tier: "FREE" }, select: { id: true } });
    await tx.subscription.updateMany({
      where: { organizationId },
      data: {
        status: "CANCELED",
        plan: "FREE",
        planId: free?.id ?? null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        cancelAtPeriodEnd: false,
        canceledAt: new Date(),
      },
    });
  }

  return {
    async handleEvent(event) {
      if (!isHandledStripeEvent(event.type)) {
        logger?.info({ stripeEventId: event.id, type: event.type }, "stripe event ignored");
        return "ignored";
      }

      const object = event.data.object;
      const type = EVENT_TYPE_MAP[event.type]!;
      const isInvoice = event.type.startsWith("invoice.");

      // Invoices reference the customer/subscription; subscription & checkout
      // objects carry the customer directly.
      const customerId = str(object.customer);

      try {
        const outcome = await prisma.$transaction(async (tx) => {
          const organizationId = await resolveOrgId(tx, object, customerId);
          if (!organizationId) {
            // Can't attribute the event to a tenant — acknowledge & skip so
            // Stripe stops retrying, but record nothing.
            logger?.warn({ stripeEventId: event.id, type: event.type }, "stripe event: org unresolved");
            return "ignored" as const;
          }

          const sub = await tx.subscription.findUnique({
            where: { organizationId },
            select: { id: true },
          });

          // Idempotency anchor: unique stripeEventId. A replay collides here and
          // the whole transaction rolls back → "duplicate", effect applied once.
          await tx.invoiceEvent.create({
            data: {
              organizationId,
              subscriptionId: sub?.id ?? null,
              stripeEventId: event.id,
              type,
              stripeInvoiceId: isInvoice ? str(object.id) : null,
              amountCents: isInvoice ? (num(object.amount_paid) ?? num(object.amount_due)) : null,
              currency: isInvoice ? str(object.currency) : null,
              status: isInvoice ? str(object.status) : str(object.status),
              hostedInvoiceUrl: isInvoice ? str(object.hosted_invoice_url) : null,
              invoicePdfUrl: isInvoice ? str(object.invoice_pdf) : null,
              periodStart: isInvoice ? unixToDate(object.period_start) : null,
              periodEnd: isInvoice ? unixToDate(object.period_end) : null,
              payload: event as unknown as Prisma.InputJsonValue,
            },
          });

          // Apply the state effect.
          switch (event.type) {
            case "checkout.session.completed": {
              // Link the customer/subscription to the org; details arrive via
              // the subsequent customer.subscription.* event.
              const subscriptionId = str(object.subscription);
              await tx.subscription.upsert({
                where: { organizationId },
                update: {
                  ...(customerId ? { stripeCustomerId: customerId } : {}),
                  ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
                },
                create: {
                  organizationId,
                  plan: "FREE",
                  status: "INCOMPLETE",
                  ...(customerId ? { stripeCustomerId: customerId } : {}),
                  ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
                },
              });
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
              await applySubscription(tx, organizationId, object);
              break;
            case "customer.subscription.deleted":
              await applyCancellation(tx, organizationId);
              break;
            case "invoice.payment_succeeded":
              await tx.subscription.updateMany({ where: { organizationId }, data: { status: "ACTIVE" } });
              break;
            case "invoice.payment_failed":
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
          metadata: { stripeEventType: event.type },
        });
        return "applied";
      } catch (err) {
        // Unique violation on stripeEventId = the event was already processed.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          logger?.info({ stripeEventId: event.id, type: event.type }, "stripe event: duplicate, skipped");
          return "duplicate";
        }
        throw err;
      }
    },
  };
}
