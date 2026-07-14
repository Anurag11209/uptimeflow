import { Router, raw } from "express";
import type { BillingProvider } from "@backend-uptime/billing";
import type { ApiErrorBody } from "@backend-uptime/shared";
import type { RazorpayEventLike, RazorpayWebhookService } from "../../services/razorpay-billing-webhook.service.js";
import type { Logger } from "../../telemetry.js";

export const RAZORPAY_WEBHOOK_PATH = "/v1/billing/webhooks/razorpay";

export interface RazorpayWebhookDeps {
  /** Absent when billing is not configured — the route then returns 503. */
  provider?: BillingProvider;
  service: RazorpayWebhookService;
  logger: Logger;
}

function errorBody(code: ApiErrorBody["error"]["code"], message: string): ApiErrorBody {
  return { error: { code, message } };
}

/**
 * Razorpay webhook receiver. Mounted at the app root BEFORE express.json() so
 * the handler sees the raw request bytes — Razorpay's HMAC-SHA256 signature
 * is computed over the exact body, and a re-serialized JSON object would not
 * verify (Razorpay docs explicitly warn about this). Unauthenticated by
 * design: the signature (RAZORPAY_WEBHOOK_SECRET) is the credential.
 *
 * Unlike Stripe, Razorpay does not embed an event id in the payload body —
 * idempotency uses the `x-razorpay-event-id` header instead, which is
 * forwarded into `verifyWebhook` as the third argument.
 *
 * Returns 200 for handled, duplicate, and ignored events so Razorpay stops
 * retrying; only an unexpected processing error returns 500 to trigger a
 * retry (Razorpay retries with exponential backoff for up to 24 hours, then
 * disables the webhook until manually re-enabled from the dashboard).
 */
export function razorpayWebhookRouter(deps: RazorpayWebhookDeps): Router {
  const router = Router();

  router.post(RAZORPAY_WEBHOOK_PATH, raw({ type: "*/*" }), async (req, res) => {
    if (!deps.provider) {
      res.status(503).json(errorBody("service_unavailable", "Billing is not configured."));
      return;
    }

    const signature = req.header("x-razorpay-signature");
    if (!signature) {
      res.status(400).json(errorBody("bad_request", "Missing x-razorpay-signature header."));
      return;
    }
    const eventId = req.header("x-razorpay-event-id");
    if (!eventId) {
      res.status(400).json(errorBody("bad_request", "Missing x-razorpay-event-id header."));
      return;
    }

    let event: RazorpayEventLike;
    try {
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body));
      event = deps.provider.verifyWebhook(body, signature, eventId) as unknown as RazorpayEventLike;
    } catch (err) {
      deps.logger.warn({ err }, "razorpay webhook signature verification failed");
      res.status(400).json(errorBody("bad_request", "Invalid webhook signature."));
      return;
    }

    try {
      const outcome = await deps.service.handleEvent(event);
      res.status(200).json({ received: true, outcome });
    } catch (err) {
      // 5xx → Razorpay retries with backoff (idempotency makes the retry safe).
      deps.logger.error({ err, razorpayEventId: event.id, type: event.type }, "razorpay webhook processing failed");
      res.status(500).json(errorBody("internal_error", "Webhook processing failed."));
    }
  });

  return router;
}
