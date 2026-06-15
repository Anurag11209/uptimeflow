"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 12) {
      setError("Password must be at least 12 characters.");
      return;
    }

    setPending(true);
    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      // After the user clicks the emailed link, Better Auth verifies the
      // token, auto-signs them in, and redirects here.
      callbackURL: `${window.location.origin}/verify-email`,
    });
    setPending(false);

    if (signUpError) {
      setError(signUpError.message ?? "Could not create your account.");
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <AuthShell
        title="Check your inbox"
        subtitle={`We sent a verification link to ${email}. Click it to activate your account, then sign in.`}
        footer={
          <Link href="/sign-in" className="text-brand hover:underline">
            Back to sign in
          </Link>
        }
      >
        <Alert tone="success">
          Account created. Email verification is required before your first
          sign-in.
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Twelve characters minimum on the password — this account will guard production."
      footer={
        <>
          Already registered?{" "}
          <Link href="/sign-in" className="text-brand hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="name">Full name</Label>
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ada Lovelace"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
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

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 12 characters"
          />
        </div>

        <Button type="submit" className="w-full" loading={pending}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
