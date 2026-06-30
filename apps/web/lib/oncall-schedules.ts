"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";

// ─── Types ────────────────────────────────────────────────────────────────────
// Mirrors oncall.service.ts exactly.

export type RotationType = "DAILY" | "WEEKLY" | "BIWEEKLY" | "CUSTOM";

export interface ScheduleListItem {
  id: string;
  name: string;
  timezone: string;
  rotationType: RotationType;
  handoffMinute: number;
  participantCount: number;
  createdAt: string;
}

export interface ScheduleParticipant {
  userId: string;
  position: number;
  name: string | null;
  email: string | null;
}

export interface ScheduleDetail extends ScheduleListItem {
  participants: ScheduleParticipant[];
}

export interface UpsertScheduleInput {
  name: string;
  timezone: string;
  rotationType: RotationType;
  handoffMinute: number;
  participants: string[]; // ordered user ids
}

export type OnCallSource = "override" | "rotation" | "empty";

export interface OnCallUser {
  userId: string;
  name: string | null;
  email: string | null;
}

export interface OnCallView {
  scheduleId: string;
  source: OnCallSource;
  primary: OnCallUser | null;
  secondary: OnCallUser | null;
}

export interface OverrideView {
  id: string;
  userId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
}

export interface OverrideInput {
  userId: string;
  startsAt: string; // ISO datetime
  endsAt: string; // ISO datetime
  reason?: string;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const onCallKeys = {
  all: (orgId: string) => ["org", orgId, "oncall-schedules"] as const,
  list: (orgId: string) => [...onCallKeys.all(orgId), "list"] as const,
  detail: (orgId: string, id: string) => [...onCallKeys.all(orgId), "detail", id] as const,
  onCall: (orgId: string, id: string) => [...onCallKeys.all(orgId), "on-call", id] as const,
  overrides: (orgId: string, id: string) => [...onCallKeys.all(orgId), "overrides", id] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/oncall-schedules`;
}

// ─── Hooks: schedules ─────────────────────────────────────────────────────────

export function useOnCallSchedules(orgId: string | undefined, enabled = true) {
  return useQuery<Page<ScheduleListItem>>({
    queryKey: onCallKeys.list(orgId ?? "none"),
    queryFn: () => api<Page<ScheduleListItem>>(`${base(orgId!)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useOnCallSchedule(orgId: string | undefined, id: string | undefined) {
  return useQuery<ScheduleDetail>({
    queryKey: onCallKeys.detail(orgId ?? "none", id ?? "none"),
    queryFn: () => api<ScheduleDetail>(`${base(orgId!)}/${id}`),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

/** Who's on call right now (or at a given instant via `at`). Poll-friendly. */
export function useWhoIsOnCall(orgId: string | undefined, id: string | undefined, enabled = true) {
  return useQuery<OnCallView>({
    queryKey: onCallKeys.onCall(orgId ?? "none", id ?? "none"),
    queryFn: () => api<OnCallView>(`${base(orgId!)}/${id}/on-call`),
    enabled: Boolean(orgId) && Boolean(id) && enabled,
    // Refresh periodically so "who's on call" stays accurate across handoffs
    refetchInterval: 60_000,
  });
}

export function useCreateOnCallSchedule(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertScheduleInput) =>
      api<ScheduleDetail>(base(orgId), { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onCallKeys.all(orgId) });
    },
  });
}

export function useUpdateOnCallSchedule(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpsertScheduleInput }) =>
      api<ScheduleDetail>(`${base(orgId)}/${id}`, { method: "PUT", body: JSON.stringify(input) }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: onCallKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: onCallKeys.detail(orgId, id) });
      void qc.invalidateQueries({ queryKey: onCallKeys.onCall(orgId, id) });
    },
  });
}

export function useDeleteOnCallSchedule(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onCallKeys.all(orgId) });
    },
  });
}

// ─── Hooks: overrides ─────────────────────────────────────────────────────────

export function useOverrides(
  orgId: string | undefined,
  scheduleId: string | undefined,
  enabled = true,
) {
  return useQuery<{ items: OverrideView[] }>({
    queryKey: onCallKeys.overrides(orgId ?? "none", scheduleId ?? "none"),
    queryFn: () => api<{ items: OverrideView[] }>(`${base(orgId!)}/${scheduleId}/overrides`),
    enabled: Boolean(orgId) && Boolean(scheduleId) && enabled,
  });
}

export function useAddOverride(orgId: string, scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OverrideInput) =>
      api<OverrideView>(`${base(orgId)}/${scheduleId}/overrides`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onCallKeys.overrides(orgId, scheduleId) });
      void qc.invalidateQueries({ queryKey: onCallKeys.onCall(orgId, scheduleId) });
    },
  });
}

export function useRemoveOverride(orgId: string, scheduleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (overrideId: string) =>
      api<void>(`${base(orgId)}/${scheduleId}/overrides/${overrideId}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: onCallKeys.overrides(orgId, scheduleId) });
      void qc.invalidateQueries({ queryKey: onCallKeys.onCall(orgId, scheduleId) });
    },
  });
}

// ─── Pure display helpers (unit-tested) ───────────────────────────────────────

export function formatRotationType(type: RotationType): string {
  const map: Record<RotationType, string> = {
    DAILY: "Daily",
    WEEKLY: "Weekly",
    BIWEEKLY: "Every 2 weeks",
    CUSTOM: "Custom",
  };
  return map[type] ?? type;
}

/** handoffMinute is minutes since UTC midnight (0–1439). Render as HH:MM. */
export function formatHandoffTime(handoffMinute: number): string {
  const h = Math.floor(handoffMinute / 60) % 24;
  const m = handoffMinute % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Inverse of formatHandoffTime — parses "HH:MM" back into total minutes. */
export function parseHandoffTime(hhmm: string): number {
  const parts = hhmm.split(":");
  const h = Number(parts[0]) || 0;
  const m = Number(parts[1]) || 0;
  return Math.min(1439, Math.max(0, h * 60 + m));
}

export function onCallSourceLabel(source: OnCallSource): string {
  if (source === "override") return "Override active";
  if (source === "rotation") return "On rotation";
  return "No one on call";
}

export function displayName(user: OnCallUser | null): string {
  if (!user) return "—";
  return user.name ?? user.email ?? user.userId;
}

/** The browser's IANA timezone, used as a sensible default when creating a schedule. */
export function defaultTimezone(): string {
  return typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC";
}

/** A reasonably sized set of common IANA zones for the picker — not exhaustive. */
export const COMMON_TIMEZONES: string[] = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Moscow",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
];
