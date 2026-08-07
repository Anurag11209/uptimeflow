import type { AlertPayload } from "./transports.js";
import { parseSlackChannelConfig } from "./slack.js";

/**
 * Shared plumbing for integration-backed alert channels (SLACK, DISCORD,
 * TELEGRAM, MICROSOFT_TEAMS).
 *
 * All four store the same config shape — `{ integrationId }` pointing at a
 * per-provider integration row — so the credential lives in one table, is
 * rotated in one place, and never lands in `alert_channels.config`.
 */

/**
 * Canonically defined in `slack.ts` (the first implementation of this pattern);
 * re-exported here under a provider-neutral name so the other transports don't
 * read as though they depend on Slack. Deliberately not moved: `slack.ts` is
 * already reviewed and shipped, and a rename there buys nothing today.
 */
export const parseIntegrationChannelConfig = parseSlackChannelConfig;

/**
 * The subset of a Prisma integration delegate these transports need. Declared
 * structurally so each transport can pass its own delegate
 * (`prisma.discordIntegration`, `prisma.telegramIntegration`, …) without the
 * shared helper depending on any one of them.
 */
export interface IntegrationFinder<TRow> {
  findFirst(args: {
    where: { id: string; organizationId: string; deletedAt: null };
    select: Record<string, true>;
  }): Promise<TRow | null>;
}

/**
 * Resolve a channel's `{ integrationId }` config to its integration row.
 *
 * Always scoped by `organizationId` and `deletedAt: null`. The id arrives from
 * tenant-supplied config, so an unscoped read would let one org deliver through
 * another org's credential — the same guard the Slack transport applies.
 */
export async function resolveIntegration<TRow>(
  finder: IntegrationFinder<TRow>,
  organizationId: string,
  config: unknown,
  select: Record<string, true>,
  providerLabel: string,
): Promise<TRow> {
  const { integrationId } = parseIntegrationChannelConfig(config);
  const row = await finder.findFirst({
    where: { id: integrationId, organizationId, deletedAt: null },
    select,
  });
  if (!row) {
    throw new Error(`The ${providerLabel} integration for this channel no longer exists.`);
  }
  return row;
}

/**
 * Map an alert into the provider-agnostic event every message builder renders.
 * Identical mapping to the Slack transport's, so an incident reads the same
 * whichever channel it arrives on.
 */
export function toAlertEvent(
  payload: AlertPayload,
  webUrl: string,
): {
  event: "incident.opened" | "incident.resolved";
  title: string;
  summary?: string;
  monitorName: string;
  status: string;
  severity?: string;
  url: string;
  timestamp: string;
} {
  const opened = payload.kind === "opened";
  return {
    event: opened ? "incident.opened" : "incident.resolved",
    title: payload.title,
    summary: payload.summary ?? undefined,
    monitorName: payload.monitorName,
    status: opened ? "DOWN" : "RESOLVED",
    severity: payload.severity ?? undefined,
    // Must match the Next.js route (apps/web/app/dashboard/incidents/[id]).
    url: `${webUrl}/dashboard/incidents/${payload.incidentId}`,
    timestamp: payload.occurredAt,
  };
}
