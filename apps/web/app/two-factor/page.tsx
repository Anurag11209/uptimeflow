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

/**
 * Second step of sign-in for accounts with TOTP enabled. The twoFactorClient
 * plugin redirects here after the password step succeeds.
 */
export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(false);
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);

    if (result.error) {
      setError(
        useBackup
          ? "That backup code is invalid or already used."
          : "That code didn't match. Codes rotate every 30 seconds — try the current one.",
      );
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      title="Two-factor check"
      subtitle={
        useBackup
          ? "Enter one of your single-use backup codes."
          : "Enter the 6-digit code from your authenticator app."
      }
      footer={
        <Link href="/sign-in" className="text-brand hover:underline">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="code">{useBackup ? "Backup code" : "Code"}</Label>
          <Input
            id="code"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            required
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder={useBackup ? "xxxxx-xxxxx" : "123456"}
            className="text-center font-[family-name:var(--font-mono)] text-lg tracking-[0.4em]"
          />
        </div>

        {!useBackup ? (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={trustDevice}
              onChange={(e) => setTrustDevice(e.target.checked)}
              className="size-4 accent-[var(--color-brand)]"
            />
            Trust this device for 30 days
          </label>
        ) : null}

        <Button type="submit" className="w-full" loading={pending}>
          Verify
        </Button>

        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode("");
            setError(null);
          }}
          className="w-full text-center text-xs text-muted hover:text-brand"
        >
          {useBackup ? "Use authenticator code instead" : "Use a backup code instead"}
        </button>
      </form>
    </AuthShell>
  );
}
