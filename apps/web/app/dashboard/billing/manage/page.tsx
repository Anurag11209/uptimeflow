"use client";

import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { hasPermission } from "@backend-uptime/shared";
import {
  cancelSubscription,
  statusTone,
  useBillingSummary,
  useInvalidateBilling,
  useInvoices,
} from "@/lib/billing";

/**
 * Razorpay has no hosted customer portal (unlike Stripe's Billing Portal), so
 * `createRazorpayBillingProvider.createPortalSession` points here instead.
 * Covers the two things people actually reach for the portal to do: see the
 * current subscription/renewal date, and cancel. Plan upgrades/downgrades
 * already live on the main billing page, so we link back there rather than
 * duplicating the plan picker.
 */
export default function ManageSubscriptionPage() {
  const { data: activeOrg, isPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canManage = role ? hasPermission(role, "billing", ["manage"]) : false;

  const summary = useBillingSummary(orgId, Boolean(role));
  const invoices = useInvoices(orgId, Boolean(role));
  const invalidate = useInvalidateBilling();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (isPending) return <p className="text-sm text-muted">Loading…</p>;

  const sum = summary.data;

  async function onCancel() {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await cancelSubscription(orgId, true);
      await invalidate(orgId);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the subscription.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <a href="/dashboard/billing" className="flex items-center gap-1 text-sm text-muted hover:text-text">
        <ArrowLeft className="size-3.5" /> Back to billing
      </a>

      <header>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          Manage subscription
        </h1>
        <p className="mt-1 text-sm text-muted">
          Payment method changes go through your bank/UPI app at renewal — Razorpay doesn't support editing a saved
          method directly. To switch plans, use the plan picker on the billing page.
        </p>
      </header>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {done ? <Alert tone="success">Your plan will not renew at the end of the current period.</Alert> : null}

      <Card className="p-5">
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

        {canManage && sum && sum.subscription.plan !== "FREE" && !sum.subscription.cancelAtPeriodEnd ? (
          <div className="mt-4 border-t border-line-soft pt-4">
            <Button variant="danger" size="sm" onClick={onCancel} loading={busy}>
              Cancel plan
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-medium text-text">Recent payments</h2>
        {invoices.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (invoices.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">No payments yet.</p>
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
                <span className="font-[family-name:var(--font-mono)] text-text">
                  {inv.amountCents !== null
                    ? new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: (inv.currency ?? "inr").toUpperCase(),
                      }).format(inv.amountCents / 100)
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
