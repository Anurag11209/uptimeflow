import type { PrismaClient } from "@backend-uptime/db";
import { DiscordNotifier, type FetchLike } from "@backend-uptime/notifications";
import type { AlertTransport } from "./transports.js";
import { resolveIntegration, toAlertEvent, type IntegrationFinder } from "./integration-channel.js";

/**
 * DISCORD alert-channel transport.
 *
 * Reuses the DiscordIntegration table and DiscordNotifier that already back the
 * org-level Integrations path — no new model, no new message format. Config is
 * `{ integrationId }`, exactly like SLACK.
 */

const SELECT = { webhookUrl: true } as const;

export interface DiscordAlertTransportDeps {
  prisma: PrismaClient;
  /** Public app origin used to build the incident deep link. */
  webUrl: string;
  /** Injected in tests; defaults to the notifier's own hardened HTTP path. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export async function resolveDiscordWebhookUrl(
  prisma: PrismaClient,
  organizationId: string,
  config: unknown,
): Promise<string> {
  const row = await resolveIntegration<{ webhookUrl: string }>(
    prisma.discordIntegration as unknown as IntegrationFinder<{ webhookUrl: string }>,
    organizationId,
    config,
    SELECT,
    "Discord",
  );
  return row.webhookUrl;
}

export function discordAlertTransport(deps: DiscordAlertTransportDeps): AlertTransport {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return async (channel, payload) => {
    const webhookUrl = await resolveDiscordWebhookUrl(deps.prisma, channel.organizationId, channel.config);
    const result = await DiscordNotifier.send(webhookUrl, toAlertEvent(payload, webUrl), {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });

    if (!result.ok) {
      throw new Error(`Discord webhook responded ${result.status}: ${result.error ?? "unknown error"}`);
    }
    // Discord webhooks answer 204 No Content — no message id unless ?wait=true.
    return { providerMessageId: null };
  };
}
