import { Router, raw } from "express";
import type { BillingProvider } from "@backend-uptime/billing";
import type { ApiErrorBody } from "@backend-uptime/shared";
import type {
  BillingWebhookService,
  StripeEventLike,
} from "../../services/billing-webhook.service.js";
import type { Logger } from "../../telemetry.js";

export const STRIPE_WEBHOOK_PATH = "/v1/billing/webhooks/stripe";

export interface StripeWebhookDeps {
  /** Absent when billing is not configured — the route then returns 503. */
  provider?: BillingProvider;
  service: BillingWebhookService;
  logger: Logger;
}

function errorBody(code: ApiErrorBody["error"]["code"], message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * Stripe webhook receiver. Mounted at the app root BEFORE express.json() so the
 * handler sees the raw request bytes — Stripe's signature is computed over the
 * exact body, and a re-serialized JSON object would not verify. Unauthenticated
 * by design: the signature (STRIPE_WEBHOOK_SECRET) is the credential.
 *
 * Returns 200 for handled, duplicate, and ignored events so Stripe stops
 * retrying; only an unexpected processing error returns 500 to trigger a retry.
 */
export function stripeWebhookRouter(deps: StripeWebhookDeps): Router {
  const router = Router();

  router.post(STRIPE_WEBHOOK_PATH, raw({ type: "*/*" }), async (req, res) => {
    if (!deps.provider) {
      res.status(503).json(errorBody("service_unavailable", "Billing is not configured."));
      return;
    }

    const signature = req.header("stripe-signature");
    if (!signature) {
      res.status(400).json(errorBody("bad_request", "Missing stripe-signature header."));
      return;
    }

    let event: StripeEventLike;
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
      event = deps.provider.verifyWebhook(body, signature) as unknown as StripeEventLike;
    } catch (err) {
      deps.logger.warn({ err }, "stripe webhook signature verification failed");
      res.status(400).json(errorBody("bad_request", "Invalid webhook signature."));
      return;
    }

    try {
      const outcome = await deps.service.handleEvent(event);
      res.status(200).json({ received: true, outcome });
    } catch (err) {
      // 5xx → Stripe retries with backoff (idempotency makes the retry safe).
      deps.logger.error({ err, stripeEventId: event.id, type: event.type }, "stripe webhook processing failed");
      res.status(500).json(errorBody("internal_error", "Webhook processing failed."));
    }
  });

  return router;
}
