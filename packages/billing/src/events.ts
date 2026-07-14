/**
 * The webhook events the billing system acts on, for each provider. Anything
 * outside these sets is acknowledged (200) and ignored, so the provider
 * doesn't retry events we don't care about. Kept here (no Prisma/db
 * dependency) so the webhook routes and their tests share one list.
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

/**
 * Razorpay Subscriptions webhook events we act on. Razorpay has no single
 * "checkout completed" event — `subscription.activated` (or
 * `subscription.authenticated` for the first charge) is the closest
 * equivalent to Stripe's `checkout.session.completed` /
 * `customer.subscription.created`. `subscription.charged` fires on every
 * successful recurring payment, mirroring `invoice.payment_succeeded`.
 */
export const HANDLED_RAZORPAY_EVENTS = [
  "subscription.authenticated",
  "subscription.activated",
  "subscription.charged",
  "subscription.updated",
  "subscription.pending",
  "subscription.halted",
  "subscription.cancelled",
  "subscription.completed",
  "payment.failed",
] as const;

export type HandledRazorpayEvent = (typeof HANDLED_RAZORPAY_EVENTS)[number];

export function isHandledRazorpayEvent(type: string): type is HandledRazorpayEvent {
  return (HANDLED_RAZORPAY_EVENTS as readonly string[]).includes(type);
}
