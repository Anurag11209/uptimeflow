import type { IntegrationEvent } from "../integrations/event.js";
import { postJson, type DeliveryResult, type FetchLike } from "../integrations/http.js";
import { SlackMessageBuilder } from "./builder.js";

export interface SlackNotifierOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Delivers an IntegrationEvent to a Slack Incoming Webhook. Pure transport: it
 * builds the message and POSTs it, returning a normalized DeliveryResult for
 * the queue processor (which owns retries/backoff/dead-lettering).
 */
export const SlackNotifier = {
  send(webhookUrl: string, event: IntegrationEvent, options: SlackNotifierOptions = {}): Promise<DeliveryResult> {
    const message = SlackMessageBuilder.build(event);
    return postJson(webhookUrl, message, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  },
};
