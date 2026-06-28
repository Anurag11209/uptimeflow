"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";
import type { Tone } from "@/lib/monitors";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertChannelType =
  | "EMAIL"
  | "SMS"
  | "VOICE"
  | "SLACK"
  | "DISCORD"
  | "TELEGRAM"
  | "MICROSOFT_TEAMS"
  | "WEBHOOK"
  | "PAGERDUTY"
  | "OPSGENIE";

// Config is an open record matching the backend's `Record<string, unknown>`.
// We don't narrow it here because each provider has different keys
// (email, phoneNumber, integrationId, routingKey, apiKey, chatId …)
// and narrowing would break as new providers are added.
export type AlertChannelConfig = Record<string, unknown>;

export interface AlertChannelItem {
  id: string;
  type: AlertChannelType;
  name: string;
  config: AlertChannelConfig;
  enabled: boolean;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannelDetail extends AlertChannelItem {
  boundMonitorIds: string[];
}

export interface CreateAlertChannelInput {
  type: AlertChannelType;
  name: string;
  config: AlertChannelConfig;
}

export type UpdateAlertChannelInput = Partial<CreateAlertChannelInput>;

// ─── Query Keys ───────────────────────────────────────────────────────────────

export const alertChannelKeys = {
  all: (orgId: string) => ["org", orgId, "alert-channels"] as const,
  list: (orgId: string) => [...alertChannelKeys.all(orgId), "list"] as const,
  detail: (orgId: string, id: string) => [...alertChannelKeys.all(orgId), "detail", id] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/alert-channels`;
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useAlertChannels(orgId: string | undefined, enabled = true) {
  return useQuery<Page<AlertChannelItem>>({
    queryKey: alertChannelKeys.list(orgId ?? "none"),
    queryFn: () => api<Page<AlertChannelItem>>(`${base(orgId!)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useAlertChannel(orgId: string | undefined, id: string | undefined) {
  return useQuery<AlertChannelDetail>({
    queryKey: alertChannelKeys.detail(orgId ?? "none", id ?? "none"),
    queryFn: () => api<AlertChannelDetail>(`${base(orgId!)}/${id}`),
    enabled: Boolean(orgId) && Boolean(id),
  });
}

export function useCreateAlertChannel(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlertChannelInput) =>
      api<AlertChannelDetail>(base(orgId), {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertChannelKeys.all(orgId) });
    },
  });
}

export function useUpdateAlertChannel(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAlertChannelInput }) =>
      api<AlertChannelDetail>(`${base(orgId)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: (data, { id }) => {
      void qc.invalidateQueries({ queryKey: alertChannelKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: alertChannelKeys.detail(orgId, id) });
    },
  });
}

export function useDeleteAlertChannel(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<{ success: boolean }>(`${base(orgId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: alertChannelKeys.all(orgId) });
    },
  });
}

export function useEnableAlertChannel(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AlertChannelDetail>(`${base(orgId)}/${id}/enable`, { method: "POST" }),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: alertChannelKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: alertChannelKeys.detail(orgId, id) });
    },
  });
}

export function useDisableAlertChannel(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<AlertChannelDetail>(`${base(orgId)}/${id}/disable`, { method: "POST" }),
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: alertChannelKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: alertChannelKeys.detail(orgId, id) });
    },
  });
}

// ─── Pure display helpers (unit-tested) ───────────────────────────────────────

export function formatChannelType(type: AlertChannelType): string {
  const map: Record<AlertChannelType, string> = {
    EMAIL: "Email",
    SMS: "SMS",
    VOICE: "Voice",
    SLACK: "Slack",
    DISCORD: "Discord",
    TELEGRAM: "Telegram",
    MICROSOFT_TEAMS: "Microsoft Teams",
    WEBHOOK: "Webhook",
    PAGERDUTY: "PagerDuty",
    OPSGENIE: "OpsGenie",
  };
  return map[type] ?? type;
}

export function channelStatusMeta(enabled: boolean): { label: string; tone: Tone } {
  return enabled ? { label: "Active", tone: "up" } : { label: "Disabled", tone: "muted" };
}

/** The single config key that holds the primary value for a given channel type. */
export function configKeyFor(type: AlertChannelType): "email" | "phoneNumber" | "integrationId" {
  if (type === "EMAIL") return "email";
  if (type === "SMS" || type === "VOICE") return "phoneNumber";
  return "integrationId";
}

/** Read the primary config value for display/editing without casting everywhere. */
export function primaryConfigValue(channel: AlertChannelItem): string {
  const key = configKeyFor(channel.type);
  const val = channel.config[key];
  return typeof val === "string" ? val : "";
}

/** Build the config payload for create/update from a single input string. */
export function buildConfig(type: AlertChannelType, value: string): AlertChannelConfig {
  return { [configKeyFor(type)]: value };
}

/** Whether this channel type is linked to an existing integration (not raw credentials). */
export function isIntegrationBacked(type: AlertChannelType): boolean {
  return type === "SLACK" || type === "DISCORD" || type === "WEBHOOK";
}

/** Stub transport — alerting pipeline runs but no real notification is sent. */
export const STUB_TRANSPORT_TYPES: AlertChannelType[] = [
  "EMAIL",
  "SMS",
  "VOICE",
  "TELEGRAM",
  "MICROSOFT_TEAMS",
  "PAGERDUTY",
  "OPSGENIE",
];
