"use client";

import { useEffect, useState } from "react";
import { CreditCard, ExternalLink, Check, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { hasPermission } from "@backend-uptime/shared";
import {
  cancelSubscription,
  changePlan,
  formatLimit,
  formatPrice,
  hasActivePaidSubscription,
  openPortal,
  startCheckout,
  statusTone,
  switchKind,
  usagePercent,
  useBillingSummary,
  useInvalidateBilling,
  useInvoices,
  usePlans,
  type PlanTier,
  type PlanView,
  type ResourceUsage,
} from "@/lib/billing";

export default function BillingPage() {
  const { data: activeOrg, isPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "billing", ["read"]) : false;
  const canManage = role ? hasPermission(role, "billing", ["manage"]) : false;

  const summary = useBillingSummary(orgId, canRead);
  const plans = usePlans(orgId, canRead);
  const invoices = useInvoices(orgId, canRead);
  const invalidate = useInvalidateBilling();

  const [banner, setBanner] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [busyTier, setBusyTier] = useState<PlanTier | null>(null);
  const [busyAction, setBusyAction] = useState<"portal" | "cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Surface the Checkout return state (?checkout=success|canceled) without
  // pulling in useSearchParams (keeps the page out of a Suspense boundary).
  useEffect(() => {
    const status = new URLSearchParams(window.location.search).get("checkout");
    if (status === "success") setBanner({ tone: "success", text: "Subscription updated — thanks!" });
    else if (status === "canceled") setBanner({ tone: "error", text: "Checkout canceled. No changes were made." });
    if (status) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (!canRead) return <Alert tone="warning">You do not have permission to view billing.</Alert>;

  const sum = summary.data;
  const activePaid = hasActivePaidSubscription(sum);

  async function onSelectPlan(tier: PlanTier) {
    if (!orgId) return;
    setBusyTier(tier);
    setError(null);
    try {
      // Modify a live subscription in place; otherwise start a fresh Checkout.
      if (activePaid) {
        await changePlan(orgId, tier);
        await invalidate(orgId);
        setBanner({ tone: "success", text: "Plan updated." });
      } else {
        await startCheckout(orgId, tier); // redirects away
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change plan.");
    } finally {
      setBusyTier(null);
    }
  }

  async function onPortal() {
    if (!orgId) return;
    setBusyAction("portal");
    setError(null);
    try {
      await openPortal(orgId); // redirects away
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open the billing portal.");
      setBusyAction(null);
    }
  }

  async function onCancel() {
    if (!orgId) return;
    setBusyAction("cancel");
    setError(null);
    try {
      await cancelSubscription(orgId, true);
      await invalidate(orgId);
      setBanner({ tone: "success", text: "Your plan will not renew at the end of the period." });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the subscription.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">Billing</h1>
        <p className="mt-1 text-sm text-muted">Manage your plan, usage, and payment method.</p>
      </header>

      {banner ? <Alert tone={banner.tone}>{banner.text}</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      {/* Current plan */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-medium text-text">{sum?.plan.limits.planName ?? "—"} plan</h2>
              {sum ? <Badge tone={statusTone(sum.subscription.status)}>{sum.subscription.status}</Badge> : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {sum?.subscription.seats ?? 1} seat{(sum?.subscription.seats ?? 1) === 1 ? "" : "s"}
              {sum?.subscription.currentPeriodEnd
                ? ` · renews ${new Date(sum.subscription.currentPeriodEnd).toLocaleDateString()}`
                : ""}
            </p>
            {sum?.subscription.cancelAtPeriodEnd ? (
              <p className="mt-1 text-sm text-down">Cancels at the end of the current period.</p>
            ) : null}
          </div>
          {canManage ? (
            <div className="flex shrink-0 gap-2">
              {sum?.subscription.hasStripeCustomer ? (
                <Button variant="secondary" size="sm" onClick={onPortal} loading={busyAction === "portal"}>
                  <CreditCard className="size-3.5" /> Manage payment method
                </Button>
              ) : null}
              {activePaid && !sum?.subscription.cancelAtPeriodEnd ? (
                <Button variant="danger" size="sm" onClick={onCancel} loading={busyAction === "cancel"}>
                  Cancel plan
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>

      {/* Usage */}
      <Card className="p-5">
        <h2 className="mb-4 font-medium text-text">Usage this period</h2>
        {sum ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <UsageMeter label="Monitors" usage={sum.plan.usage.monitor} />
            <UsageMeter label="Seats" usage={sum.plan.usage.seat} />
            <UsageMeter label="Status pages" usage={sum.plan.usage.statusPage} />
          </div>
        ) : (
          <p className="text-sm text-muted">Loading usage…</p>
        )}
        {sum && Object.keys(sum.plan.usage.metered).length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-3 border-t border-line-soft pt-4">
            {Object.entries(sum.plan.usage.metered).map(([metric, m]) => (
              <span key={metric} className="text-xs text-muted">
                <span className="font-[family-name:var(--font-mono)] text-text">{m.used}</span>
                {" / "}
                {m.included} {metric.replace("_", " ")}
              </span>
            ))}
          </div>
        ) : null}
      </Card>

      {/* Plans */}
      <Card className="p-5">
        <h2 className="mb-4 font-medium text-text">Plans</h2>
        {plans.isPending ? (
          <p className="text-sm text-muted">Loading plans…</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {(plans.data?.plans ?? [])
              .filter((p) => p.tier !== "ENTERPRISE")
              .map((plan) => (
                <PlanCard
                  key={plan.tier}
                  plan={plan}
                  currentTier={sum?.subscription.plan ?? "FREE"}
                  canManage={canManage}
                  busy={busyTier === plan.tier}
                  onSelect={() => onSelectPlan(plan.tier)}
                />
              ))}
          </div>
        )}
      </Card>

      {/* Billing history */}
      <Card className="p-5">
        <h2 className="mb-4 font-medium text-text">Billing history</h2>
        {invoices.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (invoices.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">No invoices yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {invoices.data!.items.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-4 py-3 text-sm">
                <div className="flex items-center gap-3">
                  <Badge tone={inv.type === "PAYMENT_SUCCEEDED" ? "up" : "down"}>
                    {inv.type === "PAYMENT_SUCCEEDED" ? "Paid" : "Failed"}
                  </Badge>
                  <span className="text-muted">{new Date(inv.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-mono)] text-text">
                    {inv.amountCents !== null
                      ? new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency: (inv.currency ?? "usd").toUpperCase(),
                        }).format(inv.amountCents / 100)
                      : "—"}
                  </span>
                  {inv.hostedInvoiceUrl ? (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-brand hover:underline"
                    >
                      View <ExternalLink className="size-3" />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UsageMeter({ label, usage }: { label: string; usage: ResourceUsage }) {
  const pct = usagePercent(usage.used, usage.limit);
  const over = usage.limit !== null && usage.used >= usage.limit;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-muted">{label}</span>
        <span className="font-[family-name:var(--font-mono)] text-text">
          {usage.used} / {formatLimit(usage.limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line-soft">
        <div
          className={over ? "h-full bg-down" : "h-full bg-brand"}
          style={{ width: `${usage.limit === null ? 4 : pct}%` }}
        />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  currentTier,
  canManage,
  busy,
  onSelect,
}: {
  plan: PlanView;
  currentTier: PlanTier;
  canManage: boolean;
  busy: boolean;
  onSelect: () => void;
}) {
  const kind = switchKind(currentTier, plan.tier);
  const isCurrent = kind === "current";
  const features: string[] = [
    `${formatLimit(plan.monitorLimit)} monitors`,
    `${formatLimit(plan.seatLimit)} seats`,
    `${formatLimit(plan.statusPageLimit)} status pages`,
  ];
  if (plan.smsEnabled) features.push("SMS alerts");
  if (plan.voiceEnabled) features.push("Voice calls");
  if (plan.ssoEnabled) features.push("SSO");
  if (plan.advancedAnalytics) features.push("Advanced analytics");

  return (
    <div
      className={
        "flex flex-col gap-3 rounded-lg border p-4 " +
        (isCurrent ? "border-brand/60 bg-brand/5" : "border-line-soft")
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-text">{plan.name}</span>
        {isCurrent ? <Badge tone="brand">Current</Badge> : null}
      </div>
      <div className="font-[family-name:var(--font-display)] text-lg text-text">
        {formatPrice(plan.priceCents, plan.currency)}
      </div>
      <ul className="flex flex-col gap-1.5 text-xs text-muted">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-1.5">
            <Check className="size-3 text-brand" /> {f}
          </li>
        ))}
      </ul>
      <div className="mt-auto pt-2">
        {isCurrent ? (
          <Button variant="secondary" size="sm" disabled className="w-full">
            Current plan
          </Button>
        ) : plan.purchasable && canManage ? (
          <Button variant={kind === "upgrade" ? "primary" : "secondary"} size="sm" className="w-full" onClick={onSelect} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : kind === "upgrade" ? "Upgrade" : "Downgrade"}
          </Button>
        ) : !plan.purchasable ? (
          <Button variant="ghost" size="sm" disabled className="w-full">
            Contact sales
          </Button>
        ) : null}
      </div>
    </div>
  );
}
