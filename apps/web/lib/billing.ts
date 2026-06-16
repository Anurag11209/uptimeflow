"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type PlanTier = "FREE" | "STARTER" | "GROWTH" | "BUSINESS" | "ENTERPRISE";

export interface ResourceUsage {
  limit: number | null;
  used: number;
  remaining: number | null;
}

export interface BillingSummary {
  subscription: {
    plan: PlanTier;
    status: string;
    seats: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    canceledAt: string | null;
    hasStripeCustomer: boolean;
  };
  plan: {
    limits: {
      tier: PlanTier;
      planName: string;
      monitorLimit: number | null;
      seatLimit: number | null;
      statusPageLimit: number | null;
      smsEnabled: boolean;
      voiceEnabled: boolean;
      ssoEnabled: boolean;
      advancedAnalytics: boolean;
      meteredAllowances: Record<string, number>;
    };
    usage: {
      monitor: ResourceUsage;
      seat: ResourceUsage;
      statusPage: ResourceUsage;
      metered: Record<string, { used: number; included: number }>;
    };
  };
}

export interface PlanView {
  tier: PlanTier;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  monitorLimit: number | null;
  seatLimit: number | null;
  statusPageLimit: number | null;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  ssoEnabled: boolean;
  advancedAnalytics: boolean;
  purchasable: boolean;
}

export interface InvoiceView {
  id: string;
  type: "PAYMENT_SUCCEEDED" | "PAYMENT_FAILED";
  amountCents: number | null;
  currency: string | null;
  status: string | null;
  hostedInvoiceUrl: string | null;
  invoicePdfUrl: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  createdAt: string;
}

// ── Pure helpers (unit-tested) ───────────────────────────────────────────────

/** Display order / rank of a tier, used to label a switch as up/down-grade. */
export const PLAN_RANK: Record<PlanTier, number> = {
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  BUSINESS: 3,
  ENTERPRISE: 4,
};

export function formatPrice(cents: number, currency = "usd"): string {
  if (cents === 0) return "Free";
  const amount = cents / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
  return `${formatted}/mo`;
}

/** A null limit means unlimited. */
export function formatLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : limit.toLocaleString();
}

/** Percent of a limit consumed (0–100). Unlimited reports 0. */
export function usagePercent(used: number, limit: number | null): number {
  if (limit === null || limit === 0) return limit === 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export type SwitchKind = "current" | "upgrade" | "downgrade";

export function switchKind(current: PlanTier, target: PlanTier): SwitchKind {
  if (current === target) return "current";
  return PLAN_RANK[target] > PLAN_RANK[current] ? "upgrade" : "downgrade";
}

/** True when the org already has a live paid subscription (so a tier switch
 *  should modify it in place rather than starting a fresh checkout). */
export function hasActivePaidSubscription(summary: BillingSummary | undefined): boolean {
  if (!summary) return false;
  const s = summary.subscription;
  return s.hasStripeCustomer && s.plan !== "FREE" && (s.status === "ACTIVE" || s.status === "TRIALING" || s.status === "PAST_DUE");
}

export function statusTone(status: string): "up" | "brand" | "down" | "muted" {
  switch (status) {
    case "ACTIVE":
      return "up";
    case "TRIALING":
      return "brand";
    case "PAST_DUE":
    case "UNPAID":
    case "INCOMPLETE":
      return "down";
    default:
      return "muted";
  }
}

// ── Query hooks + mutating actions ───────────────────────────────────────────

export const billingKeys = {
  summary: (orgId: string) => ["org", orgId, "billing", "summary"] as const,
  plans: (orgId: string) => ["org", orgId, "billing", "plans"] as const,
  invoices: (orgId: string) => ["org", orgId, "billing", "invoices"] as const,
};

function base(orgId: string): string {
  return `/v1/organizations/${orgId}/billing`;
}

export function useBillingSummary(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: billingKeys.summary(orgId ?? "none"),
    queryFn: () => api<BillingSummary>(base(orgId!)),
    enabled: Boolean(orgId) && enabled,
  });
}

export function usePlans(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: billingKeys.plans(orgId ?? "none"),
    queryFn: () => api<{ plans: PlanView[] }>(`${base(orgId!)}/plans`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvoices(orgId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: billingKeys.invoices(orgId ?? "none"),
    queryFn: () => api<{ items: InvoiceView[] }>(`${base(orgId!)}/invoices?limit=20`),
    enabled: Boolean(orgId) && enabled,
  });
}

export function useInvalidateBilling() {
  const queryClient = useQueryClient();
  return (orgId: string) => queryClient.invalidateQueries({ queryKey: ["org", orgId, "billing"] });
}

/** Start Checkout for a tier and redirect the browser to Stripe's hosted page. */
export async function startCheckout(orgId: string, tier: PlanTier): Promise<void> {
  const { url } = await api<{ url: string }>(`${base(orgId)}/checkout`, {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
  window.location.assign(url);
}

/** Open the Stripe billing portal (manage payment method / invoices). */
export async function openPortal(orgId: string): Promise<void> {
  const { url } = await api<{ url: string }>(`${base(orgId)}/portal`, { method: "POST" });
  window.location.assign(url);
}

export async function changePlan(orgId: string, tier: PlanTier): Promise<void> {
  await api(`${base(orgId)}/change-plan`, { method: "POST", body: JSON.stringify({ tier }) });
}

export async function cancelSubscription(orgId: string, atPeriodEnd = true): Promise<void> {
  await api(`${base(orgId)}/cancel`, { method: "POST", body: JSON.stringify({ atPeriodEnd }) });
}
