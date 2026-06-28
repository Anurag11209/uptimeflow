"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient, useSession } from "@/lib/auth-client";
import { ActiveSessions } from "@/components/settings/active-sessions";

type Stage = "idle" | "enabling" | "verifying" | "disabling";

export default function SecurityPage() {
  const { data: session, isPending, refetch } = useSession();

  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const twoFactorEnabled = session?.user.twoFactorEnabled ?? false;

  function secretFromUri(uri: string): string | null {
    try {
      return new URL(uri).searchParams.get("secret");
    } catch {
      return null;
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setNotice("Copied to clipboard.");
  }

  async function beginEnable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setPending(true);

    const { data, error: enableError } = await authClient.twoFactor.enable({
      password,
    });
    setPending(false);

    if (enableError || !data) {
      setError(enableError?.message ?? "Could not start 2FA setup. Check your password.");
      return;
    }

    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes ?? []);
    setPassword("");
    setStage("verifying");
  }

  async function confirmEnable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: verifyError } = await authClient.twoFactor.verifyTotp({
      code,
    });
    setPending(false);

    if (verifyError) {
      setError("That code didn't match. Codes rotate every 30 seconds.");
      return;
    }

    setStage("idle");
    setCode("");
    setTotpUri(null);
    setNotice("Two-factor authentication is now enabled.");
    await refetch?.();
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const { error: disableError } = await authClient.twoFactor.disable({
      password,
    });
    setPending(false);

    if (disableError) {
      setError(disableError.message ?? "Could not disable 2FA. Check your password.");
      return;
    }

    setStage("idle");
    setPassword("");
    setNotice("Two-factor authentication disabled.");
    await refetch?.();
  }

  if (isPending) {
    return <div className="h-64 animate-pulse rounded-lg bg-panel" />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          Security
        </h1>
        <p className="mt-1 text-sm text-muted">
          Protect your account with a second factor.
        </p>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}
      {notice ? <Alert tone="success">{notice}</Alert> : null}

      <Card>
        <div className="flex items-center justify-between border-b border-line-soft p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted" />
            <h2 className="font-[family-name:var(--font-display)] font-semibold">
              Two-factor authentication
            </h2>
          </div>
          {twoFactorEnabled ? (
            <Badge tone="up">Enabled</Badge>
          ) : (
            <Badge tone="muted">Disabled</Badge>
          )}
        </div>

        <div className="space-y-5 p-5">
          {/* --- Already enabled: offer disable --- */}
          {twoFactorEnabled && stage === "idle" ? (
            <>
              <p className="text-sm text-muted">
                Your account requires a time-based code at sign-in. Disabling
                removes that protection.
              </p>
              <Button variant="danger" onClick={() => setStage("disabling")}>
                <ShieldOff className="size-4" />
                Disable 2FA
              </Button>
            </>
          ) : null}

          {/* --- Not enabled, idle: start --- */}
          {!twoFactorEnabled && stage === "idle" ? (
            <>
              <p className="text-sm text-muted">
                Use any TOTP authenticator (1Password, Authy, Google
                Authenticator). You&apos;ll confirm your password, scan or paste
                the secret, then verify a code.
              </p>
              <Button onClick={() => setStage("enabling")}>
                <KeyRound className="size-4" />
                Enable 2FA
              </Button>
            </>
          ) : null}

          {/* --- Step 1: confirm password to enable --- */}
          {stage === "enabling" ? (
            <form onSubmit={beginEnable} className="max-w-sm space-y-4">
              <div className="space-y-2">
                <Label htmlFor="enable-password">Confirm your password</Label>
                <Input
                  id="enable-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" loading={pending}>
                  Continue
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setStage("idle");
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {/* --- Step 2: show secret + backup codes, verify --- */}
          {stage === "verifying" && totpUri ? (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label>Add this secret to your authenticator</Label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border border-line bg-panel-2 px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-text">
                    {secretFromUri(totpUri) ?? totpUri}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => copy(secretFromUri(totpUri) ?? totpUri)}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                </div>
                <p className="text-xs text-muted">
                  Or paste the full setup URI:
                </p>
                <button
                  type="button"
                  onClick={() => copy(totpUri)}
                  className="block w-full truncate rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-left font-[family-name:var(--font-mono)] text-[11px] text-muted hover:text-text"
                  title="Click to copy"
                >
                  {totpUri}
                </button>
              </div>

              {backupCodes.length > 0 ? (
                <div className="space-y-2">
                  <Label>Backup codes — store these now</Label>
                  <div className="grid grid-cols-2 gap-2 rounded-md border border-line-soft bg-panel-2 p-3 font-[family-name:var(--font-mono)] text-xs">
                    {backupCodes.map((bc) => (
                      <span key={bc} className="text-muted">
                        {bc}
                      </span>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => copy(backupCodes.join("\n"))}
                  >
                    <Copy className="size-3.5" />
                    Copy all codes
                  </Button>
                  <p className="text-xs text-muted">
                    Each code works once if you lose your authenticator. They
                    won&apos;t be shown again.
                  </p>
                </div>
              ) : null}

              <form onSubmit={confirmEnable} className="max-w-xs space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="verify-code">Enter a code to confirm</Label>
                  <Input
                    id="verify-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.trim())}
                    placeholder="123456"
                    className="text-center font-[family-name:var(--font-mono)] tracking-[0.3em]"
                  />
                </div>
                <Button type="submit" loading={pending}>
                  Verify &amp; enable
                </Button>
              </form>
            </div>
          ) : null}

          {/* --- Disable flow: confirm password --- */}
          {stage === "disabling" ? (
            <form onSubmit={disable} className="max-w-sm space-y-4">
              <div className="space-y-2">
                <Label htmlFor="disable-password">
                  Confirm your password to disable
                </Label>
                <Input
                  id="disable-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="flex gap-3">
                <Button type="submit" variant="danger" loading={pending}>
                  Disable 2FA
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setStage("idle");
                    setPassword("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </Card>

      <ActiveSessions />
    </div>
  );
}
