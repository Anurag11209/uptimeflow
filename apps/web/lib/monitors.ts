"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";
import { average, type ChartPoint, type DailyAvailability } from "@/lib/chart";

// ─── Enums (mirror packages/db Prisma enums) ────────────────────────────────

export type MonitorType =
  | "HTTP"
  | "TCP"
  | "PING"
  | "DNS"
  | "KEYWORD"
  | "SSL"
  | "PORT"
  | "HEARTBEAT"
  | "GRPC";

export type MonitorState = "ACTIVE" | "PAUSED" | "DISABLED";

export type MonitorHealth =
  | "UP"
  | "DOWN"
  | "DEGRADED"
  | "PENDING"
  | "PAUSED"
  | "MAINTENANCE"
  | "RECOVERING";

export type CheckStatus = "UP" | "DOWN" | "DEGRADED" | "TIMEOUT" | "ERROR";

export type HttpMethod =
  | "GET"
  | "HEAD"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "OPTIONS";

export type ProbeRegion =
  | "NA_EAST"
  | "NA_WEST"
  | "EU_WEST"
  | "EU_CENTRAL"
  | "AP_SOUTHEAST"
  | "AP_NORTHEAST"
  | "SA_EAST"
  | "AF_SOUTH";

export type AssertionSource =
  | "STATUS_CODE"
  | "RESPONSE_TIME"
  | "HEADER"
  | "BODY_TEXT"
  | "BODY_JSON"
  | "SSL_EXPIRY_DAYS"
  | "DNS_RECORD";

export type AssertionComparator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "CONTAINS"
  | "NOT_CONTAINS"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "MATCHES_REGEX"
  | "EXISTS";

export type IncidentStatus = "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

/** Probe types the backend can actually run today (DNS/GRPC are rejected 422). */
export const SUPPORTED_MONITOR_TYPES = [
  "HTTP",
  "KEYWORD",
  "SSL",
  "TCP",
  "PORT",
  "PING",
  "HEARTBEAT",
] as const satisfies readonly MonitorType[];

export const ALL_REGIONS = [
  "NA_EAST",
  "NA_WEST",
  "EU_WEST",
  "EU_CENTRAL",
  "AP_SOUTHEAST",
  "AP_NORTHEAST",
  "SA_EAST",
  "AF_SOUTH",
] as const satisfies readonly ProbeRegion[];

// ─── DTOs (dates arrive as ISO strings over JSON) ───────────────────────────

export interface AssertionView {
  id: string;
  source: AssertionSource;
  comparator: AssertionComparator;
  property: string | null;
  expected: string;
}

export interface MonitorListItem {
  id: string;
  name: string;
  type: MonitorType;
  state: MonitorState;
  health: MonitorHealth;
  url: string | null;
  host: string | null;
  port: number | null;
  intervalSeconds: number;
  groupId: string | null;
  groupName: string | null;
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  lastStatusCode: number | null;
  lastError: string | null;
  escalationPolicyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MonitorDetail extends MonitorListItem {
  httpMethod: HttpMethod | null;
  requestHeaders: Record<string, string> | null;
  requestBody: string | null;
  expectedStatus: number | null;
  keyword: string | null;
  keywordInverted: boolean;
  followRedirects: boolean;
  verifySsl: boolean;
  timeoutSeconds: number;
  retries: number;
  regions: ProbeRegion[];
  failureThreshold: number;
  successThreshold: number;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  assertions: AssertionView[];
  boundChannelIds: string[];
}

export interface CheckResultItem {
  id: string;
  region: ProbeRegion;
  status: CheckStatus;
  statusCode: number | null;
  responseMs: number | null;
  errorType: string | null;
  errorMessage: string | null;
  checkedAt: string;
}

export interface MaintenanceWindowView {
  id: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string;
  suppressAlerts: boolean;
  createdAt: string;
}

export interface AlertChannelItem {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface EscalationPolicyItem {
  id: string;
  name: string;
  description: string | null;
  repeatCount: number;
  createdAt: string;
}

export interface IncidentListItem {
  id: string;
  status: IncidentStatus;
  severity: string;
  title: string;
  summary: string | null;
  monitorId: string | null;
  monitorName: string | null;
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  durationSec: number | null;
  createdAt: string;
}

// ─── Query keys ─────────────────────────────────────────────────────────────

export const monitorKeys = {
  all: (orgId: string) => ["org", orgId, "monitors"] as const,
  detail: (orgId: string, id: string) => ["org", orgId, "monitors", id] as const,
  checks: (orgId: string, id: string) =>
    ["org", orgId, "monitors", id, "check-results"] as const,
  windows: (orgId: string, id: string) =>
    ["org", orgId, "monitors", id, "maintenance-windows"] as const,
  incidents: (orgId: string, id: string) =>
    ["org", orgId, "monitors", id, "incidents"] as const,
  channels: (orgId: string) => ["org", orgId, "alert-channels"] as const,
  policies: (orgId: string) => ["org", orgId, "escalation-policies"] as const,
};

function monitorBase(orgId: string): string {
  return `/v1/organizations/${orgId}/monitors`;
}

// ─── Payload types ──────────────────────────────────────────────────────────

export interface MonitorPayload {
  name: string;
  type: MonitorType;
  url?: string;
  host?: string;
  port?: number;
  httpMethod?: HttpMethod;
  requestHeaders?: Record<string, string>;
  expectedStatus?: number;
  keyword?: string;
  keywordInverted?: boolean;
  intervalSeconds?: number;
  timeoutSeconds?: number;
  retries?: number;
  regions?: ProbeRegion[];
  failureThreshold?: number;
  successThreshold?: number;
  escalationPolicyId?: string;
  channelIds?: string[];
}

export interface MonitorListFilters {
  health?: MonitorHealth;
  state?: MonitorState;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function useMonitors(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.all(orgId ?? "none"),
    queryFn: () => api<Page<MonitorListItem>>(`${monitorBase(orgId!)}?limit=200`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useMonitor(orgId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: monitorKeys.detail(orgId ?? "none", id ?? "none"),
    queryFn: () => api<MonitorDetail>(`${monitorBase(orgId!)}/${id}`),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useCheckResults(
  orgId: string | undefined,
  id: string | undefined,
  limit = 100,
) {
  return useQuery({
    queryKey: monitorKeys.checks(orgId ?? "none", id ?? "none"),
    queryFn: () =>
      api<Page<CheckResultItem>>(
        `${monitorBase(orgId!)}/${id}/check-results?limit=${limit}`,
      ),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useMonitorMaintenanceWindows(
  orgId: string | undefined,
  id: string | undefined,
) {
  return useQuery({
    queryKey: monitorKeys.windows(orgId ?? "none", id ?? "none"),
    queryFn: () =>
      api<MaintenanceWindowView[]>(
        `${monitorBase(orgId!)}/${id}/maintenance-windows`,
      ),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useMonitorIncidents(
  orgId: string | undefined,
  id: string | undefined,
) {
  return useQuery({
    queryKey: monitorKeys.incidents(orgId ?? "none", id ?? "none"),
    queryFn: () =>
      api<Page<IncidentListItem>>(
        `/v1/organizations/${orgId}/incidents?monitorId=${id}&limit=20`,
      ),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useAlertChannels(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.channels(orgId ?? "none"),
    queryFn: () =>
      api<Page<AlertChannelItem>>(
        `/v1/organizations/${orgId}/alert-channels?limit=100`,
      ),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useEscalationPolicies(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: monitorKeys.policies(orgId ?? "none"),
    queryFn: () =>
      api<Page<EscalationPolicyItem>>(
        `/v1/organizations/${orgId}/escalation-policies?limit=100`,
      ),
    enabled: Boolean(orgId) && enabled,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useInvalidateMonitors() {
  const queryClient = useQueryClient();
  return (orgId: string) =>
    void queryClient.invalidateQueries({ queryKey: monitorKeys.all(orgId) });
}

export function useCreateMonitor(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MonitorPayload) =>
      api<MonitorDetail>(monitorBase(orgId), {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: monitorKeys.all(orgId) });
    },
  });
}

export function useUpdateMonitor(orgId: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: MonitorPayload) =>
      api<MonitorDetail>(`${monitorBase(orgId)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(monitorKeys.detail(orgId, id), detail);
      void queryClient.invalidateQueries({ queryKey: monitorKeys.all(orgId) });
    },
  });
}

export function useDeleteMonitor(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ success: boolean }>(`${monitorBase(orgId)}/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: monitorKeys.all(orgId) });
    },
  });
}

/** Pause/resume with optimistic state flip on the cached list + detail. */
export function useToggleMonitorState(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: "pause" | "resume" }) =>
      api<MonitorDetail>(`${monitorBase(orgId)}/${id}/${action}`, {
        method: "POST",
      }),
    onMutate: async ({ id, action }) => {
      await queryClient.cancelQueries({ queryKey: monitorKeys.all(orgId) });
      const previous = queryClient.getQueryData<Page<MonitorListItem>>(
        monitorKeys.all(orgId),
      );
      const nextState: MonitorState = action === "pause" ? "PAUSED" : "ACTIVE";
      const nextHealth: MonitorHealth = action === "pause" ? "PAUSED" : "PENDING";
      if (previous) {
        queryClient.setQueryData<Page<MonitorListItem>>(monitorKeys.all(orgId), {
          ...previous,
          items: previous.items.map((m) =>
            m.id === id ? { ...m, state: nextState, health: nextHealth } : m,
          ),
        });
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(monitorKeys.all(orgId), context.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void queryClient.invalidateQueries({ queryKey: monitorKeys.all(orgId) });
      void queryClient.invalidateQueries({
        queryKey: monitorKeys.detail(orgId, id),
      });
    },
  });
}

export function useSetMonitorChannels(orgId: string, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (channelIds: string[]) =>
      api<{ channelIds: string[] }>(`${monitorBase(orgId)}/${id}/channels`, {
        method: "PUT",
        body: JSON.stringify({ channelIds }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: monitorKeys.detail(orgId, id),
      });
    },
  });
}

// ─── Display helpers (pure, unit-tested) ────────────────────────────────────

export type Tone = "up" | "down" | "muted" | "brand" | "default";

export const MONITOR_TYPE_LABELS: Record<MonitorType, string> = {
  HTTP: "HTTP(S)",
  KEYWORD: "Keyword",
  SSL: "SSL certificate",
  TCP: "TCP",
  PORT: "Port",
  PING: "Ping",
  HEARTBEAT: "Heartbeat",
  DNS: "DNS",
  GRPC: "gRPC",
};

export function monitorTypeLabel(type: MonitorType): string {
  return MONITOR_TYPE_LABELS[type] ?? type;
}

export const REGION_LABELS: Record<ProbeRegion, string> = {
  NA_EAST: "N. America (East)",
  NA_WEST: "N. America (West)",
  EU_WEST: "Europe (West)",
  EU_CENTRAL: "Europe (Central)",
  AP_SOUTHEAST: "Asia Pacific (SE)",
  AP_NORTHEAST: "Asia Pacific (NE)",
  SA_EAST: "S. America (East)",
  AF_SOUTH: "Africa (South)",
};

export function regionLabel(region: ProbeRegion): string {
  return REGION_LABELS[region] ?? region;
}

export function healthMeta(health: MonitorHealth): { label: string; tone: Tone } {
  switch (health) {
    case "UP":
      return { label: "Up", tone: "up" };
    case "DOWN":
      return { label: "Down", tone: "down" };
    case "DEGRADED":
      return { label: "Degraded", tone: "brand" };
    case "RECOVERING":
      return { label: "Recovering", tone: "brand" };
    case "MAINTENANCE":
      return { label: "Maintenance", tone: "muted" };
    case "PAUSED":
      return { label: "Paused", tone: "muted" };
    case "PENDING":
    default:
      return { label: "Pending", tone: "muted" };
  }
}

export function checkStatusMeta(status: CheckStatus): { label: string; tone: Tone } {
  switch (status) {
    case "UP":
      return { label: "Up", tone: "up" };
    case "DEGRADED":
      return { label: "Degraded", tone: "brand" };
    case "DOWN":
      return { label: "Down", tone: "down" };
    case "TIMEOUT":
      return { label: "Timeout", tone: "down" };
    case "ERROR":
    default:
      return { label: "Error", tone: "down" };
  }
}

export function incidentStatusMeta(status: IncidentStatus): {
  label: string;
  tone: Tone;
} {
  switch (status) {
    case "OPEN":
      return { label: "Open", tone: "down" };
    case "ACKNOWLEDGED":
      return { label: "Acknowledged", tone: "brand" };
    case "RESOLVED":
    default:
      return { label: "Resolved", tone: "up" };
  }
}

/** The human-facing target for a monitor (URL, or host[:port]). */
export function monitorTarget(
  m: Pick<MonitorListItem, "url" | "host" | "port">,
): string {
  if (m.url) return m.url;
  if (m.host) return m.port ? `${m.host}:${m.port}` : m.host;
  return "—";
}

export function formatResponseMs(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

/** Compact relative time, e.g. "just now", "5m ago", "3h ago", "2d ago". */
export function formatRelativeTime(
  iso: string | null,
  now: number = Date.now(),
): string {
  if (!iso) return "Never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 10) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86_400)}d ago`;
}

/** Uptime % across a set of check results (UP and DEGRADED count as available). */
export function uptimePercent(checks: Pick<CheckResultItem, "status">[]): number {
  if (checks.length === 0) return 0;
  const ok = checks.filter(
    (c) => c.status === "UP" || c.status === "DEGRADED",
  ).length;
  return (ok / checks.length) * 100;
}

export function formatUptimePercent(pct: number): string {
  if (pct === 100 || pct === 0) return `${pct}%`;
  return `${pct.toFixed(2)}%`;
}

/** Average latency over check results that recorded a response time. */
export function averageLatency(checks: CheckResultItem[]): number | null {
  return average(
    checks
      .map((c) => c.responseMs)
      .filter((v): v is number => typeof v === "number"),
  );
}

/** Latency points for the line chart — oldest→newest. */
export function toLatencyPoints(checks: CheckResultItem[]): ChartPoint[] {
  return checks
    .filter((c): c is CheckResultItem & { responseMs: number } =>
      typeof c.responseMs === "number",
    )
    .map((c) => ({ t: new Date(c.checkedAt).getTime(), value: c.responseMs }))
    .sort((a, b) => a.t - b.t);
}

/** Group checks into per-day availability buckets, oldest→newest (UTC days). */
export function toDailyAvailability(checks: CheckResultItem[]): DailyAvailability[] {
  const byDay = new Map<string, { ok: number; total: number }>();
  for (const c of checks) {
    const day = c.checkedAt.slice(0, 10); // ISO YYYY-MM-DD
    const bucket = byDay.get(day) ?? { ok: 0, total: 0 };
    bucket.total += 1;
    if (c.status === "UP" || c.status === "DEGRADED") bucket.ok += 1;
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .map(([day, { ok, total }]) => ({
      day,
      uptimePct: total === 0 ? 0 : (ok / total) * 100,
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}
