"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Landing target of the verification email. Better Auth verifies the token
 * server-side, auto-signs the user in, and redirects here; failures arrive
 * as ?error=invalid_token / token_expired.
 */
function VerifyEmailInner() {
  const params = useSearchParams();
  const error = params.get("error");

  if (error) {
    const expired = error.toLowerCase().includes("expired");
    return (
      <AuthShell
        title={expired ? "Link expired" : "Verification failed"}
        subtitle={
          expired
            ? "Verification links are valid for one hour. Sign in to request a fresh one."
            : "That verification link is invalid or was already used."
        }
        footer={
          <Link href="/sign-in" className="text-brand hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Alert tone="error">
          Verification token rejected
          <span className="font-[family-name:var(--font-mono)]"> ({error})</span>.
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Email verified"
      subtitle="Your account is active and you are signed in."
    >
      <Alert tone="success">Welcome aboard — your address is confirmed.</Alert>
      <Link href="/dashboard" className="mt-6 block">
        <Button className="w-full">Continue to dashboard</Button>
      </Link>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
