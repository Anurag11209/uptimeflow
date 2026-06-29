"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";

// ─── Types ────────────────────────────────────────────────────────────────────

export type EscalationTargetType = "USER" | "SCHEDULE" | "CHANNEL";

export interface EscalationTarget {
  id: string;
  type: EscalationTargetType;
  userId: string | null;
  scheduleId: string | null;
  channelId: string | null;
}

export interface EscalationStep {
  id: string;
  position: number;
  delayMinutes: number;
  targets: EscalationTarget[];
}

export interface EscalationPolicyListItem {
  id: string;
  name: string;
  description: string | null;
  repeatCount: number;
  stepCount: number;
  createdAt: string;
}

export interface EscalationPolicyDetail extends EscalationPolicyListItem {
  steps: EscalationStep[];
}

export interface EscalationTargetInput {
  type: EscalationTargetType;
  userId?: string;
  scheduleId?: string;
  channelId?: string;
}

export interface EscalationStepInput {
  delayMinutes: number;
  targets: EscalationTargetInput[];
}

export interface UpsertEscalationPolicyInput {
  name: string;
  description?: string;
  repeatCount?: number;
  steps: EscalationStepInput[];
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const escalationPolicyKeys = {
  all: (orgId: string) => ["org", orgId, "escalation-policies"] as const,
  list: (orgId: string) => [...escalationPolicyKeys.all(orgId), "list"] as const,
  detail: (orgId: string, id: string) =>
    [...escalationPolicyKeys.all(orgId), "detail", id] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/escalation-policies`;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useEscalationPolicies(orgId: string | undefined, enabled = true) {
  return useQuery<Page<EscalationPolicyListItem>>({
    queryKey: escalationPolicyKeys.list(orgId ?? "none"),
    queryFn: () => api<Page<EscalationPolicyListItem>>(`${base(orgId!)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useEscalationPolicy(orgId: string | undefined, id: string | undefined) {
  return useQuery<EscalationPolicyDetail>({
    queryKey: escalationPolicyKeys.detail(orgId ?? "none", id ?? "none"),
    queryFn: () => api<EscalationPolicyDetail>(`${base(orgId!)}/${id}`),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useCreateEscalationPolicy(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertEscalationPolicyInput) =>
      api<EscalationPolicyDetail>(base(orgId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: escalationPolicyKeys.all(orgId) });
    },
  });
}

export function useUpdateEscalationPolicy(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    // Backend uses PUT (full replace of steps) not PATCH
    mutationFn: ({ id, input }: { id: string; input: UpsertEscalationPolicyInput }) =>
      api<EscalationPolicyDetail>(`${base(orgId)}/${id}`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: escalationPolicyKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: escalationPolicyKeys.detail(orgId, id) });
    },
  });
}

export function useDeleteEscalationPolicy(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: escalationPolicyKeys.all(orgId) });
    },
  });
}

// ─── Pure display helpers (unit-tested) ───────────────────────────────────────

export function formatDelay(minutes: number): string {
  if (minutes === 0) return "Immediately";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatRepeat(repeatCount: number): string {
  if (repeatCount === 0) return "No repeat";
  if (repeatCount === 1) return "Repeat once";
  return `Repeat ${repeatCount}x`;
}

export function stepLabel(position: number): string {
  const ordinals = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  return `${ordinals[position] ?? `${position + 1}th`} escalation`;
}
