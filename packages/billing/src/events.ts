/**
 * The Stripe webhook events the billing system acts on. Anything outside this
 * set is acknowledged (200) and ignored, so Stripe doesn't retry events we
 * don't care about. Kept here (no Prisma/db dependency) so the webhook route
 * and its tests share one list.
 */
export const HANDLED_STRIPE_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
] as const;

export type HandledStripeEvent = (typeof HANDLED_STRIPE_EVENTS)[number];

export function isHandledStripeEvent(type: string): type is HandledStripeEvent {
  return (HANDLED_STRIPE_EVENTS as readonly string[]).includes(type);
}
