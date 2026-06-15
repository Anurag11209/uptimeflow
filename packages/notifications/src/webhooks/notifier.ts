import type { IntegrationEvent } from "../integrations/event.js";
import { postRaw, type DeliveryResult, type FetchLike } from "../integrations/http.js";
import { WebhookMessageBuilder } from "./builder.js";
import { EVENT_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, signPayload } from "./signer.js";

export interface WebhookNotifierOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Delivers a signed event to a customer webhook endpoint. The body is
 * serialized once, signed with the integration secret, and sent as raw bytes so
 * the X-UptimeFlow-Signature the customer verifies covers exactly what was sent.
 * The three X-UptimeFlow-* headers carry the event name, timestamp and HMAC.
 */
export const WebhookNotifier = {
  send(
    endpoint: string,
    secret: string,
    event: IntegrationEvent,
    options: WebhookNotifierOptions = {},
  ): Promise<DeliveryResult> {
    const payload = WebhookMessageBuilder.build(event);
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      [EVENT_HEADER]: event.event,
      [TIMESTAMP_HEADER]: event.timestamp,
      [SIGNATURE_HEADER]: signPayload(secret, event.timestamp, body),
    };
    return postRaw(endpoint, body, { headers, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  },
};
