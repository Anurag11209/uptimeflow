"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";

/**
 * Razorpay has no hosted Checkout redirect like Stripe — instead a
 * subscription is created server-side (see createRazorpayBillingProvider →
 * createCheckoutSession), and the browser opens Razorpay's Checkout.js
 * overlay against that subscription id. This page is that boot step: the
 * BillingProvider returns a url pointing here with `?subscription_id=sub_xxx`,
 * `startCheckout()` in lib/billing.ts redirects the browser to it, and this
 * page loads the Checkout.js script and opens the overlay immediately.
 *
 * When BILLING_PROVIDER=stripe this page is never reached — Stripe's
 * `createCheckoutSession` returns its own hosted url directly.
 */
export default function RazorpayCheckoutPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const subscriptionId = new URLSearchParams(window.location.search).get("subscription_id");
    if (!subscriptionId) {
      setError("Missing subscription reference. Please start checkout again from the billing page.");
      return;
    }

    const keyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    if (!keyId) {
      setError("Payment checkout is not configured. Please contact support.");
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const RazorpayCheckout = (window as any).Razorpay;
      if (!RazorpayCheckout) {
        setError("Could not load the payment form. Please try again.");
        return;
      }
      const instance = new RazorpayCheckout({
        key: keyId,
        subscription_id: subscriptionId,
        name: "UptimeFlow",
        description: "Subscription",
        theme: { color: "#f59e0b" }, // brand amber
        handler: () => {
          // Payment succeeded client-side; the authoritative state change
          // still comes from the subscription.charged webhook — this just
          // sends the user back with the same success param Stripe uses.
          window.location.assign("/dashboard/billing?checkout=success");
        },
        modal: {
          ondismiss: () => {
            window.location.assign("/dashboard/billing?checkout=canceled");
          },
        },
      });
      instance.on("payment.failed", () => {
        window.location.assign("/dashboard/billing?checkout=canceled");
      });
      instance.open();
    };
    script.onerror = () => setError("Could not load the payment form. Please check your connection and try again.");
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="flex max-w-sm flex-col items-center gap-4 p-8 text-center">
        {error ? (
          <>
            <AlertCircle className="size-8 text-down" />
            <Alert tone="error">{error}</Alert>
            <a href="/dashboard/billing" className="text-sm text-brand hover:underline">
              Back to billing
            </a>
          </>
        ) : (
          <>
            <Loader2 className="size-8 animate-spin text-brand" />
            <p className="text-sm text-muted">Opening secure checkout…</p>
          </>
        )}
      </Card>
    </div>
  );
}
