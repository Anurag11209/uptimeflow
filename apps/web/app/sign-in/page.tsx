"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
    });

    if (signInError) {
      setPending(false);
      if (signInError.status === 403) {
        setError(
          "Your email address is not verified yet. Check your inbox for the verification link.",
        );
        return;
      }
      setError(signInError.message ?? "Invalid email or password.");
      return;
    }

    // Accounts with TOTP enabled never reach here — the twoFactorClient
    // plugin redirects to /two-factor instead.
    router.push("/dashboard");
    router.refresh();
  }

  async function onSocial(provider: "github" | "google") {
    setError(null);
    await authClient.signIn.social({
      provider,
      callbackURL: `${window.location.origin}/dashboard`,
    });
  }

  return (
    <AuthShell
      title="Sign in"
      subtitle="Back to the control room."
      footer={
        <>
          No account yet?{" "}
          <Link href="/sign-up" className="text-brand hover:underline">
            Create one
          </Link>
        </>
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted hover:text-brand"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
          />
        </div>

        <Button type="submit" className="w-full" loading={pending}>
          Sign in
        </Button>
      </form>

      <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-widest text-muted/60">
        <span className="h-px flex-1 bg-line-soft" />
        or continue with
        <span className="h-px flex-1 bg-line-soft" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => onSocial("github")}>
          GitHub
        </Button>
        <Button variant="secondary" onClick={() => onSocial("google")}>
          Google
        </Button>
      </div>
    </AuthShell>
  );
}
