"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { ALL_REGIONS, regionLabel, type ProbeRegion } from "@/lib/monitors";

export type { ProbeRegion } from "@/lib/monitors";
export { ALL_REGIONS, regionLabel } from "@/lib/monitors";

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string | null;
  billingContact: string | null;
  defaultRegion: ProbeRegion | null;
  defaultAlertPolicyId: string | null;
  createdAt: string;
}

export interface OrgSettingsPayload {
  name?: string;
  slug?: string;
  logo?: string | null;
  timezone?: string | null;
  billingContact?: string | null;
  defaultRegion?: ProbeRegion | null;
  defaultAlertPolicyId?: string | null;
}

export const orgSettingsKeys = {
  detail: (orgId: string) => ["org", orgId, "settings"] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/settings`;
}

export function useOrgSettings(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: orgSettingsKeys.detail(orgId ?? "none"),
    queryFn: () => api<OrgSettings>(base(orgId!)),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useUpdateOrgSettings(orgId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: OrgSettingsPayload) =>
      api<OrgSettings>(base(orgId), { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: (settings) => {
      qc.setQueryData(orgSettingsKeys.detail(orgId), settings);
      // The org name/slug surface in the switcher + overview — refresh both.
      void qc.invalidateQueries({ queryKey: queryKeys.me });
      void qc.invalidateQueries({ queryKey: queryKeys.overview(orgId) });
    },
  });
}

// ── Region options (reuse the monitoring probe regions) ──────────────────────

export const REGION_OPTIONS: { value: ProbeRegion; label: string }[] = ALL_REGIONS.map((r) => ({
  value: r,
  label: regionLabel(r),
}));
