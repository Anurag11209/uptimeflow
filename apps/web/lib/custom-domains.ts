"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Page } from "@/lib/queries";

export type VerificationStatus = "PENDING" | "VERIFIED" | "FAILED";
export type SslStatus = "PENDING" | "ACTIVE" | "FAILED";

export interface DnsRecord {
  type: "TXT" | "CNAME";
  name: string;
  value: string;
}

export interface CustomDomain {
  id: string;
  statusPageId: string;
  domain: string;
  verificationStatus: VerificationStatus;
  sslStatus: SslStatus;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
  updatedAt: string;
  dns: { txtRecord: DnsRecord; cnameRecord: DnsRecord };
}

type Tone = "up" | "brand" | "down" | "muted";

// ── Pure status helpers (unit-tested) ────────────────────────────────────────

export function verificationMeta(status: VerificationStatus): { label: string; tone: Tone } {
  switch (status) {
    case "VERIFIED":
      return { label: "Verified", tone: "up" };
    case "FAILED":
      return { label: "Check failed", tone: "down" };
    default:
      return { label: "Pending DNS", tone: "muted" };
  }
}

export function sslMeta(status: SslStatus): { label: string; tone: Tone } {
  switch (status) {
    case "ACTIVE":
      return { label: "SSL active", tone: "up" };
    case "FAILED":
      return { label: "SSL failed", tone: "down" };
    default:
      return { label: "SSL pending", tone: "muted" };
  }
}

// ── Query hook + mutating actions ────────────────────────────────────────────

export const customDomainKeys = {
  list: (orgId: string) => ["org", orgId, "custom-domains"] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/custom-domains`;
}

export function useCustomDomains(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: customDomainKeys.list(orgId ?? "none"),
    queryFn: () => api<Page<CustomDomain>>(`${base(orgId!)}?limit=100`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvalidateCustomDomains() {
  const queryClient = useQueryClient();
  return (orgId: string) => queryClient.invalidateQueries({ queryKey: customDomainKeys.list(orgId) });
}

export function addCustomDomain(orgId: string, input: { statusPageId: string; domain: string }): Promise<CustomDomain> {
  return api<CustomDomain>(base(orgId), { method: "POST", body: JSON.stringify(input) });
}

export function verifyCustomDomain(orgId: string, id: string): Promise<CustomDomain> {
  return api<CustomDomain>(`${base(orgId)}/${id}/verify`, { method: "POST" });
}

export function removeCustomDomain(orgId: string, id: string): Promise<void> {
  return api<void>(`${base(orgId)}/${id}`, { method: "DELETE" });
}
