"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setPending(false);

    if (requestError) {
      setError(requestError.message ?? "Could not send the reset email.");
      return;
    }

    // Always confirm — never reveal whether the address exists.
    setSent(true);
  }

  if (sent) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle={`If an account exists for ${email}, a reset link is on its way. It expires in one hour.`}
        footer={
          <Link href="/sign-in" className="text-brand hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Alert tone="success">Reset email requested.</Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter the email you signed up with and we'll send a reset link."
      footer={
        <Link href="/sign-in" className="text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
          />
        </div>

        <Button type="submit" className="w-full" loading={pending}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
