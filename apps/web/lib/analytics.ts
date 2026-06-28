"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { type ProbeRegion, type Tone } from "@/lib/monitors";

// ── Types (JSON shapes from /v1/.../analytics) ───────────────────────────────

export type IncidentSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "WARNING";

export interface AnalyticsSummary {
  rangeDays: number;
  overallUptimePct: number | null;
  slaCompliancePct: number | null;
  activeMonitors: number;
  totalMonitors: number;
  activeIncidents: number;
  incidentsInRange: number;
  mttrSec: number | null;
  mtbfSec: number | null;
  avgResponseMs: number | null;
  failedChecksToday: number;
  totalChecks: number;
  downtimeSec: number;
}

export interface DailyPoint {
  day: string;
  uptimePct: number | null;
  avgResponseMs: number | null;
  totalChecks: number;
  failedChecks: number;
}

export interface AnalyticsTimeseries {
  rangeDays: number;
  points: DailyPoint[];
}

export interface RegionStat {
  region: ProbeRegion;
  avgResponseMs: number | null;
  successRatePct: number | null;
  failedChecks: number;
  totalChecks: number;
  lastOutageAt: string | null;
}

export interface RegionalAnalytics {
  rangeDays: number;
  regions: RegionStat[];
}

export interface SeverityCount {
  severity: IncidentSeverity;
  count: number;
}

export interface CauseCount {
  cause: string;
  count: number;
}

export interface MonthlyIncidentPoint {
  month: string;
  count: number;
  avgDurationSec: number | null;
}

export interface IncidentAnalytics {
  rangeDays: number;
  total: number;
  avgDurationSec: number | null;
  bySeverity: SeverityCount[];
  byCause: CauseCount[];
  monthly: MonthlyIncidentPoint[];
  longest: { id: string; title: string; durationSec: number | null; startedAt: string }[];
}

export interface SlaMonitorRow {
  monitorId: string;
  name: string;
  uptimePct: number | null;
  downtimeSec: number;
  incidents: number;
}

export interface SlaReport {
  rangeDays: number;
  slaPct: number | null;
  downtimeSec: number;
  totalIncidents: number;
  avgRecoverySec: number | null;
  monitors: SlaMonitorRow[];
}

export interface MonitorAnalytics {
  rangeDays: number;
  uptimePct: number | null;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  downtimeSec: number;
  daily: DailyPoint[];
  regions: RegionStat[];
}

// ── Range presets ────────────────────────────────────────────────────────────

export interface RangeOption {
  days: number;
  label: string;
}

export const RANGE_OPTIONS: RangeOption[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
];

export const SLA_RANGES: RangeOption[] = [
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 180, label: "180 days" },
  { days: 365, label: "1 year" },
];

// ── Query keys + hooks ───────────────────────────────────────────────────────

export const analyticsKeys = {
  summary: (orgId: string, days: number) => ["org", orgId, "analytics", "summary", days] as const,
  timeseries: (orgId: string, days: number) =>
    ["org", orgId, "analytics", "timeseries", days] as const,
  regions: (orgId: string, days: number) => ["org", orgId, "analytics", "regions", days] as const,
  incidents: (orgId: string, days: number) =>
    ["org", orgId, "analytics", "incidents", days] as const,
  sla: (orgId: string, days: number) => ["org", orgId, "analytics", "sla", days] as const,
  monitor: (orgId: string, id: string, days: number) =>
    ["org", orgId, "analytics", "monitor", id, days] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/analytics`;
}

// Analytics is computed from a daily rollup that changes slowly; cache for a
// few minutes so navigating between sub-views never refetches needlessly.
const STALE_MS = 60_000;

export function useAnalyticsSummary(orgId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.summary(orgId ?? "none", days),
    queryFn: () => api<AnalyticsSummary>(`${base(orgId!)}/summary?days=${days}`),
    enabled: Boolean(orgId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsTimeseries(orgId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.timeseries(orgId ?? "none", days),
    queryFn: () => api<AnalyticsTimeseries>(`${base(orgId!)}/timeseries?days=${days}`),
    enabled: Boolean(orgId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsRegions(orgId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.regions(orgId ?? "none", days),
    queryFn: () => api<RegionalAnalytics>(`${base(orgId!)}/regions?days=${days}`),
    enabled: Boolean(orgId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsIncidents(orgId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.incidents(orgId ?? "none", days),
    queryFn: () => api<IncidentAnalytics>(`${base(orgId!)}/incidents?days=${days}`),
    enabled: Boolean(orgId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useAnalyticsSla(orgId: string | undefined, days: number, enabled = true) {
  return useQuery({
    queryKey: analyticsKeys.sla(orgId ?? "none", days),
    queryFn: () => api<SlaReport>(`${base(orgId!)}/sla?days=${days}`),
    enabled: Boolean(orgId) && enabled,
    staleTime: STALE_MS,
  });
}

export function useMonitorAnalytics(
  orgId: string | undefined,
  monitorId: string | undefined,
  days: number,
  enabled = true,
) {
  return useQuery({
    queryKey: analyticsKeys.monitor(orgId ?? "none", monitorId ?? "none", days),
    queryFn: () => api<MonitorAnalytics>(`${base(orgId!)}/monitors/${monitorId}?days=${days}`),
    enabled: Boolean(orgId) && Boolean(monitorId) && enabled,
    staleTime: STALE_MS,
  });
}

// ── Pure calculators / formatters (unit-tested) ──────────────────────────────

export type Bucket = "day" | "week" | "month";

/**
 * Roll a daily series up into weekly or monthly buckets. Uptime is re-derived
 * from summed up/total checks (correctly weighted), response time is a simple
 * mean of the days that have data. Returns the input unchanged for "day".
 */
export function bucketDaily(points: DailyPoint[], bucket: Bucket): DailyPoint[] {
  if (bucket === "day" || points.length === 0) return points;

  const groups = new Map<string, DailyPoint[]>();
  const order: string[] = [];
  for (const p of points) {
    const key = bucket === "month" ? p.day.slice(0, 7) : isoWeekKey(p.day);
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(p);
  }

  return order.map((key) => {
    const days = groups.get(key)!;
    const totalChecks = sum(days.map((d) => d.totalChecks));
    const failedChecks = sum(days.map((d) => d.failedChecks));
    const upChecks = totalChecks - failedChecks;
    const responseDays = days.filter((d) => d.avgResponseMs !== null);
    const avg =
      responseDays.length > 0
        ? Math.round(sum(responseDays.map((d) => d.avgResponseMs!)) / responseDays.length)
        : null;
    return {
      day: days[0]!.day,
      uptimePct: totalChecks > 0 ? round2((upChecks / totalChecks) * 100) : null,
      avgResponseMs: avg,
      totalChecks,
      failedChecks,
    };
  });
}

/** Failure rate (%) of a daily series — failed / total across the window. */
export function failureRate(points: DailyPoint[]): number | null {
  const total = sum(points.map((p) => p.totalChecks));
  if (total === 0) return null;
  return round2((sum(points.map((p) => p.failedChecks)) / total) * 100);
}

/** Average availability across the days that reported any checks. */
export function averageAvailability(points: DailyPoint[]): number | null {
  const withData = points.filter((p) => p.uptimePct !== null);
  if (withData.length === 0) return null;
  return round2(sum(withData.map((p) => p.uptimePct!)) / withData.length);
}

export function formatPct(pct: number | null | undefined, digits = 2): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return "—";
  return `${pct.toFixed(digits)}%`;
}

/** Human duration from seconds: "—", "45s", "9m", "2h 5m", "1d 3h". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || Number.isNaN(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return h > 0 && m % 60 > 0 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 > 0 ? `${d}d ${h % 24}h` : `${d}d`;
}

export function severityMeta(severity: IncidentSeverity): { label: string; tone: Tone } {
  switch (severity) {
    case "CRITICAL":
      return { label: "Critical", tone: "down" };
    case "MAJOR":
      return { label: "Major", tone: "down" };
    case "MINOR":
      return { label: "Minor", tone: "brand" };
    case "WARNING":
      return { label: "Warning", tone: "muted" };
  }
}

/** Color band for an uptime/SLA figure (mirrors the public status page). */
export function uptimeBand(pct: number | null): Tone {
  if (pct === null) return "muted";
  if (pct >= 99.9) return "up";
  if (pct >= 95) return "brand";
  return "down";
}

// ── internals ────────────────────────────────────────────────────────────────

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Year+ISO-week key (e.g. "2026-W26") used to bucket a daily series weekly. */
function isoWeekKey(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  const target = new Date(date);
  // ISO week: Thursday determines the week-year.
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const week = 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
