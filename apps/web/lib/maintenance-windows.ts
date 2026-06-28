"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ─── Types ─────────────────────────────────────────────────────────────────────
// Mirrors the Prisma MaintenanceWindowWithMonitors shape from the service layer.
// The API serialises DateTime → ISO string over JSON, so startsAt/endsAt are strings here.

export interface MonitorRef {
  id: string;
  name: string;
}

export interface MaintenanceWindow {
  id: string;
  organizationId: string;
  title: string;
  description: string | null;
  startsAt: string; // ISO string from JSON serialisation
  endsAt: string; // ISO string from JSON serialisation
  recurrenceRule: string | null;
  suppressAlerts: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  monitors: MonitorRef[];
}

export interface CreateMaintenanceWindowInput {
  title: string;
  description?: string;
  startsAt: string; // ISO datetime string, validated by Zod .datetime() on the API
  endsAt: string; // ISO datetime string
  monitorIds: string[];
}

// ─── Display helpers ──────────────────────────────────────────────────────────

export function windowStatus(
  w: MaintenanceWindow,
  now = Date.now(),
): "upcoming" | "active" | "past" {
  const start = new Date(w.startsAt).getTime();
  const end = new Date(w.endsAt).getTime();
  if (now < start) return "upcoming";
  if (now <= end) return "active";
  return "past";
}

export function fmtDateRange(startsAt: string, endsAt: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return `${fmt(startsAt)} → ${fmt(endsAt)}`;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const maintenanceKeys = {
  list: (orgId: string) => ["org", orgId, "maintenance-windows"] as const,
};

function base(orgId: string) {
  return `/v1/organizations/${orgId}/maintenance-windows`;
}

// ─── Query hooks ──────────────────────────────────────────────────────────────

export function useMaintenanceWindows(orgId: string | undefined) {
  return useQuery<MaintenanceWindow[]>({
    queryKey: maintenanceKeys.list(orgId ?? "none"),
    queryFn: () => api<MaintenanceWindow[]>(base(orgId!)),
    enabled: Boolean(orgId),
  });
}

export function useInvalidateMaintenanceWindows() {
  const qc = useQueryClient();
  return (orgId: string) => qc.invalidateQueries({ queryKey: maintenanceKeys.list(orgId) });
}

// ─── API mutation functions ───────────────────────────────────────────────────

export function createWindow(
  orgId: string,
  input: CreateMaintenanceWindowInput,
): Promise<MaintenanceWindow> {
  return api<MaintenanceWindow>(base(orgId), {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// The DELETE endpoint returns { success: true } with status 200
export function deleteWindow(orgId: string, windowId: string): Promise<{ success: boolean }> {
  return api<{ success: boolean }>(`${base(orgId)}/${windowId}`, {
    method: "DELETE",
  });
}
