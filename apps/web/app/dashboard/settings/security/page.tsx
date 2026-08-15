"use client";

import { useState, type FormEvent } from "react";
import { Copy, KeyRound, QrCode as QrIcon, ShieldCheck, ShieldOff } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { QRCode } from "@/components/ui/qr-code";
import { useToast } from "@/components/ui/toast";
import { authClient, useSession } from "@/lib/auth-client";
import { ActiveSessions } from "@/components/settings/active-sessions";

type Stage = "idle" | "enabling" | "verifying" | "disabling";

export default function SecurityPage() {
  const { data: session, isPending, refetch } = useSession();
  const { toast } = useToast();

  const [stage, setStage] = useState<Stage>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const twoFactorEnabled = session?.user.twoFactorEnabled ?? false;

  function secretFromUri(uri: string): string | null {
    try {
      return new URL(uri).searchParams.get("secret");
    } catch {
      return null;
    }
  }

  async function copy(value: string, label = "Copied to clipboard.") {
    await navigator.clipboard.writeText(value);
    toast(label, "success");
  }

  async function beginEnable(event: FormEvent) {
    event.preventDefault();
    setError(null);
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
    toast("Two-factor authentication is now enabled.", "success");
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
    toast("Two-factor authentication disabled.", "info");
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
                Use any TOTP authenticator (1Password, Apple Keychain, Google
                Authenticator, Authy). You&apos;ll confirm your password, scan the
                QR code, then verify a 6-digit code.
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
                <PasswordInput
                  id="enable-password"
                  name="password"
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

          {/* --- Step 2: show QR code + secret + backup codes, verify --- */}
          {stage === "verifying" && totpUri ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="flex flex-col items-center gap-2">
                  <QRCode value={totpUri} size={170} />
                  <span className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted">
                    <QrIcon className="size-3" /> Scan with app
                  </span>
                </div>

                <div className="flex-1 space-y-3">
                  <Label>Or enter secret key manually</Label>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded-md border border-line bg-panel-2 px-3 py-2 font-[family-name:var(--font-mono)] text-xs text-text">
                      {secretFromUri(totpUri) ?? totpUri}
                    </code>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => copy(secretFromUri(totpUri) ?? totpUri, "Secret key copied.")}
                      aria-label="Copy secret key"
                    >
                      <Copy className="size-3.5" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted">
                    Compatible with Google Authenticator, 1Password, Bitwarden, Apple Passwords, or Authy.
                  </p>
                </div>
              </div>

              {backupCodes.length > 0 ? (
                <div className="space-y-2 border-t border-line-soft pt-4">
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
                    onClick={() => copy(backupCodes.join("\n"), "All backup codes copied.")}
                  >
                    <Copy className="size-3.5" />
                    Copy all codes
                  </Button>
                  <p className="text-xs text-muted">
                    Each code works once if you lose access to your authenticator. They won&apos;t be shown again.
                  </p>
                </div>
              ) : null}

              <form onSubmit={confirmEnable} className="max-w-xs space-y-3 border-t border-line-soft pt-4">
                <div className="space-y-2">
                  <Label htmlFor="verify-code">Enter the 6-digit code</Label>
                  <Input
                    id="verify-code"
                    name="code"
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
                <PasswordInput
                  id="disable-password"
                  name="password"
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
