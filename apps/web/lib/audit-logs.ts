"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";
import type { CsvRow } from "@/lib/export";

export interface AuditLogRow {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: string;
}

export interface AuditLogFilters {
  action?: string;
  resourceType?: string;
  actorId?: string;
  from?: string;
  to?: string;
}

export const auditLogKeys = {
  list: (orgId: string, filters: AuditLogFilters) =>
    ["org", orgId, "audit-logs", "list", filters] as const,
};

function queryString(filters: AuditLogFilters, cursor: string | null): string {
  const params = new URLSearchParams({ limit: "50" });
  if (filters.action) params.set("action", filters.action);
  if (filters.resourceType) params.set("resourceType", filters.resourceType);
  if (filters.actorId) params.set("actorId", filters.actorId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export function useAuditLogList(
  orgId: string | undefined,
  filters: AuditLogFilters,
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: auditLogKeys.list(orgId ?? "none", filters),
    enabled: Boolean(orgId) && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api<Page<AuditLogRow>>(
        `/v1/organizations/${orgId}/audit-logs?${queryString(filters, pageParam)}`,
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** "organization.updated" → "Organization updated". */
export function actionLabel(action: string): string {
  const spaced = action.replace(/[._]/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "user" | "api_key" | "system" → a friendly actor-type label. */
export function actorTypeLabel(actorType: string): string {
  switch (actorType) {
    case "user":
      return "User";
    case "api_key":
      return "API key";
    case "system":
      return "System";
    default:
      return actorType;
  }
}

/**
 * Audit actions encode their outcome ("...failed"/"...rejected" = failure).
 * Everything else is a successful, recorded action.
 */
export function auditResult(action: string): { label: string; ok: boolean } {
  const failed = /(fail|failed|reject|denied|error)/i.test(action);
  return failed ? { label: "Failed", ok: false } : { label: "Success", ok: true };
}

/** Flatten audit rows into CSV-ready records for export. */
export function auditCsvRows(rows: AuditLogRow[]): CsvRow[] {
  return rows.map((r) => ({
    timestamp: r.createdAt,
    actor: r.actorId ?? "",
    actorType: r.actorType,
    action: r.action,
    resourceType: r.resourceType,
    resourceId: r.resourceId ?? "",
    ipAddress: r.ipAddress ?? "",
    result: auditResult(r.action).label,
  }));
}

export const AUDIT_CSV_COLUMNS = [
  "timestamp",
  "actor",
  "actorType",
  "action",
  "resourceType",
  "resourceId",
  "ipAddress",
  "result",
];
