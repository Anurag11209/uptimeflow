"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgRole } from "@backend-uptime/shared";
import { isOrgRole } from "@backend-uptime/shared";
import { api } from "@/lib/api";

/** Shapes returned by the custom /v1 surface (apps/api). */

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: string;
}

export interface MeResponse {
  user: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image: string | null;
    twoFactorEnabled: boolean;
    createdAt: string;
  };
  activeOrganizationId: string | null;
  memberships: Array<{
    id: string;
    role: string;
    joinedAt: string;
    organization: OrganizationSummary;
  }>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MemberRow {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface InvitationRow {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: string;
  createdAt: string;
  inviter: { id: string; name: string; email: string } | null;
}

export interface AuditLogRow {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  createdAt: string;
}

export interface OverviewResponse {
  organization: OrganizationSummary;
  role: string;
  stats: {
    members: number;
    pendingInvitations: number;
    auditEventsLast30d: number;
    monitors: number;
    openIncidents: number;
  };
}

export const queryKeys = {
  me: ["me"] as const,
  overview: (orgId: string) => ["org", orgId, "overview"] as const,
  members: (orgId: string) => ["org", orgId, "members"] as const,
  invitations: (orgId: string) => ["org", orgId, "invitations"] as const,
  auditLogs: (orgId: string, limit: number) =>
    ["org", orgId, "audit-logs", limit] as const,
};

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>("/v1/me"),
  });
}

export interface ActiveOrg {
  organization: OrganizationSummary;
  role: OrgRole;
  membershipId: string;
}

/**
 * Resolve the active organization + the viewer's role in it from /v1/me.
 * Falls back to the first membership when no active org is set yet.
 */
export function useActiveOrg(): {
  data: ActiveOrg | null;
  me: MeResponse | undefined;
  isPending: boolean;
  error: unknown;
} {
  const { data: me, isPending, error } = useMe();

  if (!me) {
    return { data: null, me, isPending, error };
  }

  const membership =
    me.memberships.find(
      (candidate) => candidate.organization.id === me.activeOrganizationId,
    ) ?? me.memberships[0];

  if (!membership || !isOrgRole(membership.role)) {
    return { data: null, me, isPending, error };
  }

  return {
    data: {
      organization: membership.organization,
      role: membership.role,
      membershipId: membership.id,
    },
    me,
    isPending,
    error,
  };
}

export function useOverview(orgId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.overview(orgId ?? "none"),
    queryFn: () => api<OverviewResponse>(`/v1/organizations/${orgId}/overview`),
    enabled: Boolean(orgId),
  });
}

export function useMembers(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.members(orgId ?? "none"),
    queryFn: () =>
      api<Page<MemberRow>>(`/v1/organizations/${orgId}/members?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvitations(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invitations(orgId ?? "none"),
    queryFn: () =>
      api<Page<InvitationRow>>(
        `/v1/organizations/${orgId}/invitations?status=pending&limit=100`,
      ),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useAuditLogs(
  orgId: string | undefined,
  limit = 10,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.auditLogs(orgId ?? "none", limit),
    queryFn: () =>
      api<Page<AuditLogRow>>(
        `/v1/organizations/${orgId}/audit-logs?limit=${limit}`,
      ),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvalidateOrg() {
  const queryClient = useQueryClient();
  return (orgId: string) => {
    void queryClient.invalidateQueries({ queryKey: ["org", orgId] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me });
  };
}
