import type { IntegrationEvent } from "../integrations/event.js";
import { postJson, type DeliveryResult, type FetchLike } from "../integrations/http.js";
import { MsTeamsMessageBuilder } from "./builder.js";

export interface MsTeamsNotifierOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

/**
 * Delivers an IntegrationEvent to a Microsoft Teams webhook. Pure transport:
 * builds the Adaptive Card envelope and POSTs it, returning a normalized
 * DeliveryResult for the caller (which owns retries/backoff).
 *
 * Note on status codes: a Teams Workflows trigger answers 202 Accepted, and the
 * legacy connector answers 200 with the body "1". Both land in postJson's
 * 2xx-is-success branch, so no special casing is needed — but it does mean a
 * 2xx here proves Teams *accepted* the card, not that it rendered.
 */
export const MsTeamsNotifier = {
  send(
    webhookUrl: string,
    event: IntegrationEvent,
    options: MsTeamsNotifierOptions = {},
  ): Promise<DeliveryResult> {
    return postJson(webhookUrl, MsTeamsMessageBuilder.build(event), {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
  },
};
