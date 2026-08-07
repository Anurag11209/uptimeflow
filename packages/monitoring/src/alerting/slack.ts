import type { PrismaClient } from "@backend-uptime/db";
import { SlackNotifier, type FetchLike, type IntegrationEvent } from "@backend-uptime/notifications";
import type { AlertPayload, AlertTransport } from "./transports.js";

/**
 * SLACK alert-channel transport.
 *
 * A SLACK channel does not store a webhook URL of its own — its config holds
 * `{ integrationId }` pointing at an existing SlackIntegration, which is what
 * the web form already builds (`configKeyFor` in apps/web/lib/alert-channels).
 * Keeping the credential in one place means a rotated webhook URL is updated
 * once, and no Slack secret is duplicated into alert_channels.config.
 *
 * Message rendering and the outbound POST are reused wholesale from the
 * org-level Integrations path (SlackNotifier → postJson, which pins the
 * resolved IP at connect time for SSRF safety), so both routes to Slack
 * produce byte-identical messages. This file is only the adapter between the
 * alerting pipeline's AlertPayload and that machinery.
 */

/** UUID shape guard — a malformed id would otherwise surface as a raw Prisma
 *  `invalid input syntax for type uuid` error instead of a usable message. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape-check a SLACK channel config. Throws with a message safe to show an
 * operator. Exported so config validation at write time and delivery at send
 * time agree on exactly what a valid config is.
 */
export function parseSlackChannelConfig(config: unknown): { integrationId: string } {
  const integrationId = (config as { integrationId?: unknown } | null | undefined)?.integrationId;
  if (typeof integrationId !== "string" || integrationId.trim().length === 0) {
    throw new Error("Slack channel config must include an integrationId.");
  }
  if (!UUID_RE.test(integrationId)) {
    throw new Error("Slack channel config integrationId is not a valid id.");
  }
  return { integrationId };
}

/**
 * Resolve a SLACK channel's config to the webhook URL to POST to.
 *
 * Always scoped by `organizationId` — the integration id arrives from
 * tenant-supplied config, so an unscoped lookup would let one org address
 * another org's Slack workspace.
 */
export async function resolveSlackWebhookUrl(
  prisma: PrismaClient,
  organizationId: string,
  config: unknown,
): Promise<string> {
  const { integrationId } = parseSlackChannelConfig(config);
  const integration = await prisma.slackIntegration.findFirst({
    where: { id: integrationId, organizationId, deletedAt: null },
    select: { webhookUrl: true },
  });
  if (!integration) {
    throw new Error("The Slack integration for this channel no longer exists.");
  }
  return integration.webhookUrl;
}

/**
 * Map an alert into the provider-agnostic event the Slack builder renders.
 * Mirrors `createIntegrationDispatcher.dispatchIncident` so an incident looks
 * the same whether it arrived via an alert channel or an org integration.
 */
export function toSlackAlertEvent(payload: AlertPayload, webUrl: string): IntegrationEvent {
  const opened = payload.kind === "opened";
  return {
    event: opened ? "incident.opened" : "incident.resolved",
    title: payload.title,
    summary: payload.summary ?? undefined,
    monitorName: payload.monitorName,
    status: opened ? "DOWN" : "RESOLVED",
    severity: payload.severity ?? undefined,
    url: `${webUrl}/incidents/${payload.incidentId}`,
    timestamp: payload.occurredAt,
  };
}

export interface SlackAlertTransportDeps {
  prisma: PrismaClient;
  /** Public app origin used to build the incident deep link. */
  webUrl: string;
  /** Injected in tests; defaults to the notifier's own hardened HTTP path. */
  fetchImpl?: FetchLike;
  /** Per-send timeout passed through to the notifier. */
  timeoutMs?: number;
}

export function slackAlertTransport(deps: SlackAlertTransportDeps): AlertTransport {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return async (channel, payload) => {
    const webhookUrl = await resolveSlackWebhookUrl(deps.prisma, channel.organizationId, channel.config);
    const result = await SlackNotifier.send(webhookUrl, toSlackAlertEvent(payload, webUrl), {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });

    if (!result.ok) {
      // Throwing hands the retry/backoff decision to BullMQ, per the
      // AlertTransport contract. Slack answers 4xx for a revoked or malformed
      // webhook and 429/5xx for throttling, which is exactly what should retry.
      throw new Error(`Slack webhook responded ${result.status}: ${result.error ?? "unknown error"}`);
    }
    // Incoming Webhooks reply with the literal body "ok" — there is no
    // provider-side message id to record.
    return { providerMessageId: null };
  };
}
