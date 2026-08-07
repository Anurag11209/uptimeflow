import type { PrismaClient } from "@backend-uptime/db";
import { MsTeamsNotifier, type FetchLike } from "@backend-uptime/notifications";
import type { AlertTransport } from "./transports.js";
import { resolveIntegration, toAlertEvent, type IntegrationFinder } from "./integration-channel.js";

/**
 * MICROSOFT_TEAMS alert-channel transport. Config is `{ integrationId }`
 * pointing at an MsTeamsIntegration, whose `webhookUrl` is itself the
 * credential (it embeds a signed token), so it is never echoed into errors.
 */

const SELECT = { webhookUrl: true } as const;

export interface MsTeamsAlertTransportDeps {
  prisma: PrismaClient;
  /** Public app origin used to build the incident deep link. */
  webUrl: string;
  /** Injected in tests; defaults to the notifier's own hardened HTTP path. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export async function resolveMsTeamsWebhookUrl(
  prisma: PrismaClient,
  organizationId: string,
  config: unknown,
): Promise<string> {
  const row = await resolveIntegration<{ webhookUrl: string }>(
    prisma.msTeamsIntegration as unknown as IntegrationFinder<{ webhookUrl: string }>,
    organizationId,
    config,
    SELECT,
    "Microsoft Teams",
  );
  return row.webhookUrl;
}

export function msTeamsAlertTransport(deps: MsTeamsAlertTransportDeps): AlertTransport {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return async (channel, payload) => {
    const webhookUrl = await resolveMsTeamsWebhookUrl(deps.prisma, channel.organizationId, channel.config);
    const result = await MsTeamsNotifier.send(webhookUrl, toAlertEvent(payload, webUrl), {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });

    if (!result.ok) {
      throw new Error(`Microsoft Teams webhook responded ${result.status}: ${result.error ?? "unknown error"}`);
    }
    // Workflows answers 202 Accepted with no body; the legacy connector 200 "1".
    // Neither returns an id, and a 2xx means accepted, not rendered.
    return { providerMessageId: null };
  };
}
