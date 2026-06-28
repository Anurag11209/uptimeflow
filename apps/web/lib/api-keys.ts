"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { permissionStatements } from "@backend-uptime/shared";
import { api } from "@/lib/api";
import type { Tone } from "@/lib/monitors";

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  /** Plaintext token — shown exactly once. */
  token: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  /** ISO date; omit for no expiry. */
  expiresAt?: string;
}

export const apiKeyKeys = {
  list: (orgId: string) => ["org", orgId, "api-keys"] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/api-keys`;
}

export function useApiKeys(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: apiKeyKeys.list(orgId ?? "none"),
    queryFn: () => api<{ items: ApiKeySummary[] }>(base(orgId!)),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useCreateApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) =>
      api<CreatedApiKey>(base(orgId), { method: "POST", body: JSON.stringify(input) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeyKeys.list(orgId) });
    },
  });
}

export function useRevokeApiKey(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: apiKeyKeys.list(orgId) });
    },
  });
}

// ── Scope catalog (derived from the shared RBAC matrix) ──────────────────────

export interface ScopeGroup {
  resource: string;
  scopes: string[];
}

/** Grouped `resource:action` scopes a key can be granted, plus the `*` wildcard. */
export const SCOPE_GROUPS: ScopeGroup[] = Object.entries(permissionStatements).map(
  ([resource, actions]) => ({
    resource,
    scopes: (actions as readonly string[]).map((a) => `${resource}:${a}`),
  }),
);

export const ALL_SCOPE_STRINGS: string[] = SCOPE_GROUPS.flatMap((g) => g.scopes);

// ── Pure status helpers (unit-tested) ────────────────────────────────────────

export type ApiKeyStatus = "active" | "expired" | "revoked";

export function apiKeyStatus(
  key: Pick<ApiKeySummary, "revokedAt" | "expiresAt">,
  now: number = Date.now(),
): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.expiresAt && new Date(key.expiresAt).getTime() <= now) return "expired";
  return "active";
}

export function apiKeyStatusMeta(status: ApiKeyStatus): { label: string; tone: Tone } {
  switch (status) {
    case "active":
      return { label: "Active", tone: "up" };
    case "expired":
      return { label: "Expired", tone: "muted" };
    case "revoked":
      return { label: "Revoked", tone: "down" };
  }
}

/** Common expiry presets → an absolute ISO date, or undefined for "never". */
export function expiryFromPreset(preset: string, now: number = Date.now()): string | undefined {
  const days: Record<string, number> = { "30d": 30, "60d": 60, "90d": 90, "365d": 365 };
  const d = days[preset];
  return d ? new Date(now + d * 86_400_000).toISOString() : undefined;
}

export const EXPIRY_PRESETS: { value: string; label: string }[] = [
  { value: "never", label: "No expiration" },
  { value: "30d", label: "30 days" },
  { value: "60d", label: "60 days" },
  { value: "90d", label: "90 days" },
  { value: "365d", label: "1 year" },
];
