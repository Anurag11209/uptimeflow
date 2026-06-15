import type { IntegrationEvent } from "../integrations/event.js";
import { postJson, type DeliveryResult, type FetchLike } from "../integrations/http.js";
import { DiscordMessageBuilder } from "./builder.js";

export interface DiscordNotifierOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Delivers an IntegrationEvent to a Discord channel webhook. Pure transport:
 * builds the embed payload and POSTs it, returning a normalized DeliveryResult
 * for the queue processor (which owns retries/backoff/dead-lettering).
 */
export const DiscordNotifier = {
  send(webhookUrl: string, event: IntegrationEvent, options: DiscordNotifierOptions = {}): Promise<DeliveryResult> {
    const message = DiscordMessageBuilder.build(event);
    return postJson(webhookUrl, message, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  },
};
