"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";
import type { IncidentListItem, IncidentStatus, Tone } from "@/lib/monitors";

export type { IncidentListItem, IncidentStatus } from "@/lib/monitors";

// ─── Enums ──────────────────────────────────────────────────────────────────

export type IncidentSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "WARNING";

export type IncidentEventType =
  | "DETECTED"
  | "ACKNOWLEDGED"
  | "ESCALATED"
  | "NOTIFICATION_SENT"
  | "COMMENT"
  | "STATUS_CHANGED"
  | "RESOLVED"
  | "REOPENED";

// ─── DTOs ───────────────────────────────────────────────────────────────────

export interface IncidentTimelineEvent {
  id: string;
  type: IncidentEventType;
  message: string | null;
  actorId: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface IncidentDetail extends IncidentListItem {
  cause: string | null;
  acknowledgedById: string | null;
  events: IncidentTimelineEvent[];
}

export type IncidentTab = "ALL" | "OPEN" | "ACKNOWLEDGED" | "RESOLVED";

// ─── Query keys ─────────────────────────────────────────────────────────────

export const incidentKeys = {
  list: (orgId: string, tab: IncidentTab) =>
    ["org", orgId, "incidents", "list", tab] as const,
  summary: (orgId: string, status: IncidentStatus | "ALL") =>
    ["org", orgId, "incidents", "summary", status] as const,
  detail: (orgId: string, id: string) =>
    ["org", orgId, "incidents", "detail", id] as const,
};

export const POLL_MS = 10_000;

/**
 * Polling decision for a single incident: poll live until resolved, then stop.
 * Pure so the cadence is unit-testable without mounting a component.
 */
export function pollIntervalForStatus(
  status: IncidentStatus | undefined,
): number | false {
  if (!status) return false;
  return status === "RESOLVED" ? false : POLL_MS;
}

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/incidents`;
}

function statusParam(tab: IncidentTab): string {
  return tab === "ALL" ? "" : `&status=${tab}`;
}

// ─── List (infinite scroll + optional polling) ──────────────────────────────

export function useIncidentList(
  orgId: string | undefined,
  tab: IncidentTab,
  enabled = true,
) {
  const poll = tab === "OPEN" || tab === "ACKNOWLEDGED" || tab === "ALL";
  return useInfiniteQuery({
    queryKey: incidentKeys.list(orgId ?? "none", tab),
    enabled: Boolean(orgId) && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<IncidentListItem>>(
        `${base(orgId!)}?limit=20${statusParam(tab)}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""
        }`,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: poll ? POLL_MS : false,
  });
}

/**
 * Lightweight single-page fetch used by the summary widgets. Separate key from
 * the infinite list so the two never collide.
 */
export function useIncidentSummary(
  orgId: string | undefined,
  status: IncidentStatus | "ALL",
  enabled = true,
  poll = false,
) {
  return useQuery({
    queryKey: incidentKeys.summary(orgId ?? "none", status),
    enabled: Boolean(orgId) && enabled,
    refetchInterval: poll ? POLL_MS : false,
    queryFn: () =>
      api<Page<IncidentListItem>>(
        `${base(orgId!)}?limit=100${status === "ALL" ? "" : `&status=${status}`}`,
      ),
  });
}

// ─── Detail (polls until resolved) ──────────────────────────────────────────

export function useIncident(orgId: string | undefined, id: string | undefined) {
  return useQuery({
    queryKey: incidentKeys.detail(orgId ?? "none", id ?? "none"),
    enabled: Boolean(orgId) && Boolean(id),
    queryFn: () => api<IncidentDetail>(`${base(orgId!)}/${id}`),
    // Live updates while the incident is unresolved; stops once resolved.
    refetchInterval: (query) =>
      pollIntervalForStatus(
        (query.state.data as IncidentDetail | undefined)?.status,
      ),
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

export function useInvalidateIncidents() {
  const queryClient = useQueryClient();
  return (orgId: string, id?: string) => {
    void queryClient.invalidateQueries({
      queryKey: ["org", orgId, "incidents"],
    });
    void queryClient.invalidateQueries({ queryKey: ["org", orgId, "monitors"] });
    if (id) {
      void queryClient.invalidateQueries({
        queryKey: incidentKeys.detail(orgId, id),
      });
    }
  };
}

export function useAcknowledgeIncident(orgId: string, id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIncidents();
  return useMutation({
    mutationFn: () =>
      api<IncidentDetail>(`${base(orgId)}/${id}/acknowledge`, {
        method: "POST",
      }),
    onSuccess: (detail) => {
      queryClient.setQueryData(incidentKeys.detail(orgId, id), detail);
      invalidate(orgId, id);
    },
  });
}

export function useResolveIncident(orgId: string, id: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateIncidents();
  return useMutation({
    mutationFn: () =>
      api<IncidentDetail>(`${base(orgId)}/${id}/resolve`, { method: "POST" }),
    onSuccess: (detail) => {
      queryClient.setQueryData(incidentKeys.detail(orgId, id), detail);
      invalidate(orgId, id);
    },
  });
}

export function useCommentIncident(orgId: string, id: string) {
  const invalidate = useInvalidateIncidents();
  return useMutation({
    mutationFn: (message: string) =>
      api<IncidentTimelineEvent>(`${base(orgId)}/${id}/comment`, {
        method: "POST",
        body: JSON.stringify({ message }),
      }),
    onSuccess: () => invalidate(orgId, id),
  });
}

// ─── Display helpers (pure, unit-tested) ────────────────────────────────────

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  CRITICAL: "Critical",
  MAJOR: "Major",
  MINOR: "Minor",
  WARNING: "Warning",
};

export function severityMeta(severity: string): { label: string; tone: Tone } {
  switch (severity) {
    case "CRITICAL":
      return { label: "Critical", tone: "down" };
    case "MAJOR":
      return { label: "Major", tone: "down" };
    case "MINOR":
      return { label: "Minor", tone: "brand" };
    case "WARNING":
      return { label: "Warning", tone: "brand" };
    default:
      return { label: severity, tone: "muted" };
  }
}

export interface EventMeta {
  label: string;
  tone: Tone;
  /** lucide-react icon name resolved by the timeline component. */
  icon:
    | "alert"
    | "check"
    | "bell"
    | "arrow-up"
    | "message"
    | "shuffle"
    | "rotate";
}

export function eventMeta(type: IncidentEventType): EventMeta {
  switch (type) {
    case "DETECTED":
      return { label: "Incident detected", tone: "down", icon: "alert" };
    case "ACKNOWLEDGED":
      return { label: "Acknowledged", tone: "brand", icon: "check" };
    case "ESCALATED":
      return { label: "Escalated", tone: "down", icon: "arrow-up" };
    case "NOTIFICATION_SENT":
      return { label: "Alert sent", tone: "muted", icon: "bell" };
    case "COMMENT":
      return { label: "Comment", tone: "default", icon: "message" };
    case "STATUS_CHANGED":
      return { label: "Status changed", tone: "muted", icon: "shuffle" };
    case "RESOLVED":
      return { label: "Resolved", tone: "up", icon: "check" };
    case "REOPENED":
      return { label: "Reopened", tone: "down", icon: "rotate" };
    default:
      return { label: type, tone: "muted", icon: "shuffle" };
  }
}

/** Human-readable duration, e.g. "—", "45s", "5m 3s", "2h 14m", "1d 3h". */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) {
    const s = Math.floor(seconds % 60);
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rm = m % 60;
    return rm ? `${h}h ${rm}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Elapsed seconds for a still-open incident (from startedAt to now). */
export function liveDurationSec(
  incident: Pick<IncidentListItem, "startedAt" | "resolvedAt" | "durationSec">,
  now: number = Date.now(),
): number | null {
  if (incident.durationSec !== null) return incident.durationSec;
  const started = new Date(incident.startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.round((now - started) / 1000));
}
