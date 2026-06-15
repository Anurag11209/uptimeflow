/**
 * Shared types + pure presentational helpers for the public status page.
 * Kept transport- and React-free so they can be unit tested in the node env
 * (see tests/status.test.ts) and reused by the server component and the
 * client subscribe form.
 */

export type ComponentStatus =
  | "OPERATIONAL"
  | "DEGRADED_PERFORMANCE"
  | "PARTIAL_OUTAGE"
  | "MAJOR_OUTAGE"
  | "UNDER_MAINTENANCE";

export type IncidentStatus = "INVESTIGATING" | "IDENTIFIED" | "MONITORING" | "RESOLVED";
export type IncidentImpact = "NONE" | "MINOR" | "MAJOR" | "CRITICAL" | "MAINTENANCE";
export type BadgeTone = "default" | "brand" | "up" | "down" | "muted";

export interface PublicStatusComponent {
  id: string;
  name: string;
  description: string | null;
  groupName: string | null;
  status: ComponentStatus;
  showUptime: boolean;
}

export interface PublicStatusIncidentUpdate {
  status: IncidentStatus;
  body: string;
  createdAt: string;
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updates: PublicStatusIncidentUpdate[];
}

export interface PublicStatusPage {
  name: string;
  slug: string;
  description: string | null;
  branding: { logoUrl?: string; accent?: string } | null;
  overallStatus: ComponentStatus;
  components: PublicStatusComponent[];
  activeIncidents: PublicStatusIncident[];
  updatedAt: string;
}

export interface StatusHistoryDay {
  day: string;
  uptimePct: number | null;
}

export interface StatusHistoryComponent {
  id: string;
  name: string;
  uptimePct: number | null;
  days: StatusHistoryDay[];
}

export interface StatusHistory {
  windowDays: number;
  overallUptimePct: number | null;
  components: StatusHistoryComponent[];
}

interface StatusMeta {
  label: string;
  tone: BadgeTone;
  /** Tailwind text color class for the status dot. */
  dot: string;
}

export const COMPONENT_STATUS_META: Record<ComponentStatus, StatusMeta> = {
  OPERATIONAL: { label: "Operational", tone: "up", dot: "bg-up" },
  DEGRADED_PERFORMANCE: { label: "Degraded performance", tone: "brand", dot: "bg-warn" },
  PARTIAL_OUTAGE: { label: "Partial outage", tone: "brand", dot: "bg-warn" },
  MAJOR_OUTAGE: { label: "Major outage", tone: "down", dot: "bg-down" },
  UNDER_MAINTENANCE: { label: "Under maintenance", tone: "muted", dot: "bg-muted" },
};

const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
};

export function componentStatusMeta(status: ComponentStatus): StatusMeta {
  return COMPONENT_STATUS_META[status];
}

export function incidentStatusLabel(status: IncidentStatus): string {
  return INCIDENT_STATUS_LABEL[status];
}

/** Headline summarizing the whole page from its worst component. */
export function overallHeadline(status: ComponentStatus): string {
  if (status === "OPERATIONAL") return "All systems operational";
  if (status === "UNDER_MAINTENANCE") return "Under maintenance";
  return COMPONENT_STATUS_META[status].label;
}

export function isAllOperational(status: ComponentStatus): boolean {
  return status === "OPERATIONAL";
}

/** "99.98%" or an em dash when there is no data for the window. */
export function formatUptime(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(2)}%`;
}

/** Color band for an uptime bar/figure. */
export function uptimeTone(pct: number | null | undefined): BadgeTone {
  if (pct === null || pct === undefined) return "muted";
  if (pct >= 99.9) return "up";
  if (pct >= 95) return "brand";
  return "down";
}

/** Tailwind bg class for a single day bar in the 90-day chart. */
export function uptimeBarColor(pct: number | null): string {
  if (pct === null) return "bg-line";
  if (pct >= 99.9) return "bg-up";
  if (pct >= 95) return "bg-warn";
  return "bg-down";
}
