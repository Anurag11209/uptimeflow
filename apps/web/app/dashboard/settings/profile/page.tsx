"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { authClient, useSession } from "@/lib/auth-client";
import {
  loadProfilePrefs,
  saveProfilePrefs,
  LANGUAGES,
  type ProfilePrefs,
} from "@/lib/profile-prefs";

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-5">
      <h2 className="mb-4 font-[family-name:var(--font-display)] text-sm font-semibold text-text">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

export default function ProfilePage() {
  const { data: session, isPending, refetch } = useSession();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [image, setImage] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [revokeOthers, setRevokeOthers] = useState(true);
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [prefs, setPrefs] = useState<ProfilePrefs>(() => loadProfilePrefs());

  useEffect(() => {
    if (session?.user) {
      setName(session.user.name ?? "");
      setImage(session.user.image ?? "");
    }
  }, [session?.user]);

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    const { error } = await authClient.updateUser({ name: name.trim(), image: image.trim() || undefined });
    setSavingProfile(false);
    if (error) {
      toast(error.message ?? "Could not update profile.", "error");
      return;
    }
    toast("Profile updated.", "success");
    void refetch();
  }

  async function onChangeEmail(e: FormEvent) {
    e.preventDefault();
    if (!newEmail.trim()) return;
    setSavingEmail(true);
    const { error } = await authClient.changeEmail({ newEmail: newEmail.trim() });
    setSavingEmail(false);
    if (error) {
      toast(error.message ?? "Could not change email.", "error");
      return;
    }
    toast("Check your inbox to confirm the new email.", "success");
    setNewEmail("");
  }

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      return;
    }
    setSavingPassword(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: revokeOthers,
    });
    setSavingPassword(false);
    if (error) {
      setPasswordError(error.message ?? "Could not change password.");
      return;
    }
    toast("Password changed.", "success");
    setCurrentPassword("");
    setNewPassword("");
  }

  function updatePref<K extends keyof ProfilePrefs>(key: K, value: ProfilePrefs[K]) {
    setPrefs((p) => {
      const next = { ...p, [key]: value };
      saveProfilePrefs(next);
      return next;
    });
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!session?.user) {
    return <Alert tone="warning">You must be signed in to view your profile.</Alert>;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <form onSubmit={onSaveProfile}>
        <Section title="Profile">
          <div className="flex items-center gap-4">
            <span className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-full border border-line bg-panel-2 text-lg text-muted">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt="" className="size-full object-cover" />
              ) : (
                (session.user.name ?? "?").charAt(0).toUpperCase()
              )}
            </span>
            <Field label="Avatar URL" htmlFor="image" hint="Link to an image (PNG, JPG, or SVG).">
              <Input id="image" value={image} onChange={(e) => setImage(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
          <Field label="Name" htmlFor="name">
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" loading={savingProfile}>Save profile</Button>
          </div>
        </Section>
      </form>

      <form onSubmit={onChangeEmail}>
        <Section title="Email">
          <Field label="Current email" htmlFor="current-email">
            <div className="flex items-center gap-2">
              <Input id="current-email" value={session.user.email} readOnly className="text-muted" />
              <Badge tone={session.user.emailVerified ? "up" : "muted"}>
                {session.user.emailVerified ? "Verified" : "Unverified"}
              </Badge>
            </div>
          </Field>
          <Field label="New email" htmlFor="new-email" hint="We'll send a confirmation link to the new address.">
            <Input id="new-email" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@acme.com" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={savingEmail} disabled={!newEmail.trim()}>
              Change email
            </Button>
          </div>
        </Section>
      </form>

      <form onSubmit={onChangePassword}>
        <Section title="Password">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Current password" htmlFor="current-password">
              <Input id="current-password" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </Field>
            <Field label="New password" htmlFor="new-password" hint="At least 8 characters.">
              <Input id="new-password" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={revokeOthers}
              onChange={(e) => setRevokeOthers(e.target.checked)}
              className="size-4 rounded border-line bg-panel-2 accent-brand"
            />
            Sign out other sessions
          </label>
          {passwordError ? <Alert tone="error">{passwordError}</Alert> : null}
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" loading={savingPassword} disabled={!currentPassword || !newPassword}>
              Change password
            </Button>
          </div>
        </Section>
      </form>

      <Section title="Preferences">
        <p className="-mt-2 text-xs text-muted">Saved on this device.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Timezone" htmlFor="pref-tz">
            <Input
              id="pref-tz"
              value={prefs.timezone}
              onChange={(e) => updatePref("timezone", e.target.value)}
              className="font-[family-name:var(--font-mono)]"
            />
          </Field>
          <Field label="Language" htmlFor="pref-lang">
            <Select id="pref-lang" value={prefs.language} onChange={(e) => updatePref("language", e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Notifications</Label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={prefs.notifyIncidents} onChange={(e) => updatePref("notifyIncidents", e.target.checked)} className="size-4 rounded border-line bg-panel-2 accent-brand" />
            Email me when an incident opens
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={prefs.notifyMaintenance} onChange={(e) => updatePref("notifyMaintenance", e.target.checked)} className="size-4 rounded border-line bg-panel-2 accent-brand" />
            Email me about scheduled maintenance
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={prefs.notifyWeeklyReport} onChange={(e) => updatePref("notifyWeeklyReport", e.target.checked)} className="size-4 rounded border-line bg-panel-2 accent-brand" />
            Send me the weekly summary report
          </label>
        </div>
      </Section>
    </div>
  );
}
