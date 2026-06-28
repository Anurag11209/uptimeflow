"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";
import {
  COMPONENT_STATUS_META,
  componentStatusMeta,
  incidentStatusLabel,
  type BadgeTone,
  type ComponentStatus,
  type IncidentImpact,
  type IncidentStatus,
} from "@/lib/status";

export type { ComponentStatus, IncidentImpact, IncidentStatus } from "@/lib/status";
export { componentStatusMeta, incidentStatusLabel } from "@/lib/status";

// ── Types (JSON shapes returned by /v1/.../status-pages) ─────────────────────

export type StatusPageVisibility = "PUBLIC" | "UNLISTED" | "PRIVATE";
export type SubscriberStatus = "PENDING" | "ACTIVE" | "UNSUBSCRIBED";

export interface SocialLink {
  label: string;
  url: string;
}

export interface StatusPageBranding {
  logoUrl?: string | null;
  faviconUrl?: string | null;
  accent?: string | null;
  footerText?: string | null;
  timezone?: string | null;
  socialLinks?: SocialLink[];
}

export interface StatusPageSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  customDomain: string | null;
  visibility: StatusPageVisibility;
  isPublic: boolean;
  branding: StatusPageBranding | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatusPageListItem extends StatusPageSummary {
  componentCount: number;
  subscriberCount: number;
  overallStatus: ComponentStatus;
}

export interface StatusComponent {
  id: string;
  monitorId: string | null;
  name: string;
  description: string | null;
  groupName: string | null;
  status: ComponentStatus;
  position: number;
  showUptime: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedIncidentUpdate {
  status: IncidentStatus;
  body: string;
  createdAt: string;
}

export interface ManagedIncident {
  id: string;
  title: string;
  status: IncidentStatus;
  impact: IncidentImpact;
  startedAt: string;
  resolvedAt: string | null;
  createdAt: string;
  updates: ManagedIncidentUpdate[];
}

export interface StatusSubscriber {
  id: string;
  email: string;
  status: SubscriberStatus;
  createdAt: string;
  verifiedAt: string | null;
  unsubscribedAt: string | null;
}

export interface SubscriberListResult {
  items: StatusSubscriber[];
  nextCursor: string | null;
  counts: { total: number; active: number; pending: number; unsubscribed: number };
}

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface StatusPagePayload {
  name: string;
  slug: string;
  description?: string | null;
  customDomain?: string | null;
  visibility?: StatusPageVisibility;
  branding?: StatusPageBranding | null;
  components?: Array<{
    monitorId?: string | null;
    displayName: string;
    description?: string | null;
    groupName?: string | null;
    sortOrder?: number;
  }>;
}

export interface ComponentPayload {
  monitorId?: string | null;
  name?: string;
  description?: string | null;
  groupName?: string | null;
  status?: ComponentStatus;
  showUptime?: boolean;
  position?: number;
}

// ── Static option lists (selects) ────────────────────────────────────────────

export const COMPONENT_STATUSES: ComponentStatus[] = [
  "OPERATIONAL",
  "DEGRADED_PERFORMANCE",
  "PARTIAL_OUTAGE",
  "MAJOR_OUTAGE",
  "UNDER_MAINTENANCE",
];

export const VISIBILITIES: StatusPageVisibility[] = ["PUBLIC", "UNLISTED", "PRIVATE"];

export const INCIDENT_STATUSES: IncidentStatus[] = [
  "INVESTIGATING",
  "IDENTIFIED",
  "MONITORING",
  "RESOLVED",
];

export const INCIDENT_IMPACTS: IncidentImpact[] = ["MINOR", "MAJOR", "CRITICAL", "MAINTENANCE"];

// ── Pure presentational helpers (unit-tested) ────────────────────────────────

export function visibilityMeta(v: StatusPageVisibility): { label: string; tone: BadgeTone } {
  switch (v) {
    case "PUBLIC":
      return { label: "Public", tone: "up" };
    case "UNLISTED":
      return { label: "Unlisted", tone: "brand" };
    case "PRIVATE":
      return { label: "Private", tone: "muted" };
  }
}

export function impactMeta(impact: IncidentImpact): { label: string; tone: BadgeTone } {
  switch (impact) {
    case "NONE":
      return { label: "None", tone: "muted" };
    case "MINOR":
      return { label: "Minor", tone: "brand" };
    case "MAJOR":
      return { label: "Major", tone: "down" };
    case "CRITICAL":
      return { label: "Critical", tone: "down" };
    case "MAINTENANCE":
      return { label: "Maintenance", tone: "muted" };
  }
}

export function incidentStatusMeta(status: IncidentStatus): { label: string; tone: BadgeTone } {
  return {
    label: incidentStatusLabel(status),
    tone: status === "RESOLVED" ? "up" : "brand",
  };
}

export function subscriberStatusMeta(status: SubscriberStatus): { label: string; tone: BadgeTone } {
  switch (status) {
    case "ACTIVE":
      return { label: "Active", tone: "up" };
    case "PENDING":
      return { label: "Pending", tone: "brand" };
    case "UNSUBSCRIBED":
      return { label: "Unsubscribed", tone: "muted" };
  }
}

/**
 * Roll up component statuses into the page headline status (worst wins),
 * mirroring the server's overallStatus derivation so the dashboard preview
 * matches the public page.
 */
const STATUS_SEVERITY: Record<ComponentStatus, number> = {
  OPERATIONAL: 0,
  UNDER_MAINTENANCE: 1,
  DEGRADED_PERFORMANCE: 2,
  PARTIAL_OUTAGE: 3,
  MAJOR_OUTAGE: 4,
};

export function overallStatus(components: { status: ComponentStatus }[]): ComponentStatus {
  return components.reduce<ComponentStatus>(
    (worst, c) => (STATUS_SEVERITY[c.status] > STATUS_SEVERITY[worst] ? c.status : worst),
    "OPERATIONAL",
  );
}

export function componentStatusLabel(status: ComponentStatus): string {
  return COMPONENT_STATUS_META[status].label;
}

/** Public URL for a status page (slug-based; the custom domain overrides it). */
export function publicStatusUrl(page: Pick<StatusPageSummary, "slug">): string {
  return `/status/${page.slug}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── Query keys + base path ───────────────────────────────────────────────────

export const statusPageKeys = {
  all: (orgId: string) => ["org", orgId, "status-pages"] as const,
  detail: (orgId: string, id: string) => ["org", orgId, "status-pages", id] as const,
  components: (orgId: string, id: string) =>
    ["org", orgId, "status-pages", id, "components"] as const,
  incidents: (orgId: string, id: string) =>
    ["org", orgId, "status-pages", id, "incidents"] as const,
  subscribers: (orgId: string, id: string) =>
    ["org", orgId, "status-pages", id, "subscribers"] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/status-pages`;
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function useStatusPages(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: statusPageKeys.all(orgId ?? "none"),
    queryFn: () => api<Page<StatusPageListItem>>(`${base(orgId!)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useStatusPage(orgId: string | undefined, id: string, enabled = true) {
  return useQuery({
    queryKey: statusPageKeys.detail(orgId ?? "none", id),
    queryFn: () => api<StatusPageSummary>(`${base(orgId!)}/${id}`),
    enabled: Boolean(orgId) && Boolean(id) && enabled,
  });
}

export function useStatusPageComponents(orgId: string | undefined, id: string, enabled = true) {
  return useQuery({
    queryKey: statusPageKeys.components(orgId ?? "none", id),
    queryFn: () => api<{ items: StatusComponent[] }>(`${base(orgId!)}/${id}/components`),
    enabled: Boolean(orgId) && Boolean(id) && enabled,
  });
}

export function useStatusPageIncidents(orgId: string | undefined, id: string, enabled = true) {
  return useQuery({
    queryKey: statusPageKeys.incidents(orgId ?? "none", id),
    queryFn: () => api<Page<ManagedIncident>>(`${base(orgId!)}/${id}/incidents?limit=100`),
    enabled: Boolean(orgId) && Boolean(id) && enabled,
  });
}

export function useStatusPageSubscribers(orgId: string | undefined, id: string, enabled = true) {
  return useQuery({
    queryKey: statusPageKeys.subscribers(orgId ?? "none", id),
    queryFn: () => api<SubscriberListResult>(`${base(orgId!)}/${id}/subscribers?limit=100`),
    enabled: Boolean(orgId) && Boolean(id) && enabled,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateStatusPage(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: StatusPagePayload) =>
      api<StatusPageSummary>(base(orgId), { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.all(orgId) });
    },
  });
}

export function useUpdateStatusPage(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<StatusPagePayload> }) =>
      api<StatusPageSummary>(`${base(orgId)}/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: (page) => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.all(orgId) });
      void qc.invalidateQueries({ queryKey: statusPageKeys.detail(orgId, page.id) });
    },
  });
}

export function useDeleteStatusPage(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`${base(orgId)}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.all(orgId) });
    },
  });
}

/**
 * Duplicate a page by re-creating it from its summary + components. The slug
 * must be globally unique, so we suffix it; the caller can rename afterwards.
 */
export function useDuplicateStatusPage(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (source: StatusPageSummary) => {
      const components = await api<{ items: StatusComponent[] }>(
        `${base(orgId)}/${source.id}/components`,
      );
      const payload: StatusPagePayload = {
        name: `${source.name} (copy)`,
        slug: dedupeSlug(source.slug),
        description: source.description,
        visibility: "PRIVATE", // copies start private to avoid clobbering live pages
        branding: source.branding,
        components: components.items.map((c, i) => ({
          monitorId: c.monitorId,
          displayName: c.name,
          description: c.description,
          groupName: c.groupName,
          sortOrder: i,
        })),
      };
      return api<StatusPageSummary>(base(orgId), { method: "POST", body: JSON.stringify(payload) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.all(orgId) });
    },
  });
}

function dedupeSlug(slug: string): string {
  const suffix = `-copy-${Math.floor(Date.now() / 1000) % 100000}`;
  return `${slug.slice(0, 63 - suffix.length)}${suffix}`;
}

// ── Component mutations ──────────────────────────────────────────────────────

export function useCreateComponent(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ComponentPayload) =>
      api<StatusComponent>(`${base(orgId)}/${pageId}/components`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.components(orgId, pageId) });
    },
  });
}

export function useUpdateComponent(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ComponentPayload }) =>
      api<StatusComponent>(`${base(orgId)}/${pageId}/components/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    // Optimistically reflect status/visibility toggles for snappy editing.
    onMutate: async ({ id, payload }) => {
      const key = statusPageKeys.components(orgId, pageId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: StatusComponent[] }>(key);
      if (previous) {
        qc.setQueryData<{ items: StatusComponent[] }>(key, {
          items: previous.items.map((c) => (c.id === id ? { ...c, ...payload } : c)),
        });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(statusPageKeys.components(orgId, pageId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.components(orgId, pageId) });
    },
  });
}

export function useDeleteComponent(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<void>(`${base(orgId)}/${pageId}/components/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.components(orgId, pageId) });
    },
  });
}

export function useReorderComponents(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orderedIds: string[]) =>
      api<{ items: StatusComponent[] }>(`${base(orgId)}/${pageId}/components/reorder`, {
        method: "POST",
        body: JSON.stringify({ orderedIds }),
      }),
    onMutate: async (orderedIds) => {
      const key = statusPageKeys.components(orgId, pageId);
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<{ items: StatusComponent[] }>(key);
      if (previous) {
        const byId = new Map(previous.items.map((c) => [c.id, c]));
        const reordered = orderedIds
          .map((id, i) => {
            const c = byId.get(id);
            return c ? { ...c, position: i } : null;
          })
          .filter((c): c is StatusComponent => c !== null);
        qc.setQueryData<{ items: StatusComponent[] }>(key, { items: reordered });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) {
        qc.setQueryData(statusPageKeys.components(orgId, pageId), ctx.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.components(orgId, pageId) });
    },
  });
}

// ── Incident mutations ───────────────────────────────────────────────────────

export interface OpenIncidentPayload {
  title: string;
  body: string;
  impact?: IncidentImpact;
}

export function useOpenIncident(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OpenIncidentPayload) =>
      api<ManagedIncident>(`${base(orgId)}/${pageId}/incidents`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.incidents(orgId, pageId) });
    },
  });
}

export interface IncidentUpdatePayload {
  status: IncidentStatus;
  body: string;
}

export function useAddIncidentUpdate(orgId: string, pageId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ incidentId, payload }: { incidentId: string; payload: IncidentUpdatePayload }) =>
      api<ManagedIncident>(`${base(orgId)}/${pageId}/incidents/${incidentId}/updates`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: statusPageKeys.incidents(orgId, pageId) });
    },
  });
}
