/**
 * Provider-agnostic description of something worth notifying about. The monitor
 * pipeline / incident service builds one of these and the per-provider message
 * builders (Slack blocks, Discord embeds, signed webhook JSON) render it. Kept
 * transport- and Prisma-free so every builder is a pure, unit-testable function.
 */

export type IntegrationEventName =
  | "incident.opened"
  | "incident.acknowledged"
  | "incident.updated"
  | "incident.resolved"
  | "maintenance.created"
  | "maintenance.updated"
  | "test";

export interface IntegrationEvent {
  event: IntegrationEventName;
  /** Headline, e.g. "Acme API is down". */
  title: string;
  /** Optional detail line (cause / latest update / message). */
  summary?: string;
  organizationName?: string;
  monitorName?: string;
  /** Human status label, e.g. "DOWN" / "RESOLVED" / "ACKNOWLEDGED". */
  status?: string;
  severity?: string;
  /** Deep link back into the app / status page. */
  url?: string;
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
}

export interface EventStyle {
  /** Hex color (no leading #) for accent bars. */
  hex: string;
  /** 24-bit int form of `hex`, for Discord embeds. */
  decimal: number;
  /** Slack attachment color keyword or hex. */
  slackColor: string;
  emoji: string;
  label: string;
}

const RED = "FF5C5C";
const GREEN = "2FD180";
const AMBER = "FFB224";
const BLUE = "4C9AFF";
const GREY = "94A1B8";

const STYLES: Record<IntegrationEventName, Omit<EventStyle, "decimal">> = {
  "incident.opened": { hex: RED, slackColor: "danger", emoji: "🔴", label: "Incident opened" },
  "incident.acknowledged": { hex: AMBER, slackColor: "warning", emoji: "🟠", label: "Incident acknowledged" },
  "incident.updated": { hex: AMBER, slackColor: "warning", emoji: "🟡", label: "Incident updated" },
  "incident.resolved": { hex: GREEN, slackColor: "good", emoji: "🟢", label: "Incident resolved" },
  "maintenance.created": { hex: BLUE, slackColor: BLUE, emoji: "🛠️", label: "Maintenance scheduled" },
  "maintenance.updated": { hex: BLUE, slackColor: BLUE, emoji: "🛠️", label: "Maintenance updated" },
  test: { hex: GREY, slackColor: GREY, emoji: "✅", label: "Test notification" },
};

export function eventStyle(event: IntegrationEventName): EventStyle {
  const base = STYLES[event];
  return { ...base, decimal: parseInt(base.hex, 16) };
}
