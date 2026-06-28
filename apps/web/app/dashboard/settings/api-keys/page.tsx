"use client";

import { useMemo, useState } from "react";
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useActiveOrg, useMe } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import {
  apiKeyStatus,
  apiKeyStatusMeta,
  EXPIRY_PRESETS,
  expiryFromPreset,
  SCOPE_GROUPS,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKeySummary,
  type CreatedApiKey,
} from "@/lib/api-keys";
import { hasPermission } from "@backend-uptime/shared";

type View = "org" | "personal";

export default function ApiKeysPage() {
  const { data: activeOrg } = useActiveOrg();
  const me = useMe();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const userId = me.data?.user.id;

  const canRead = role ? hasPermission(role, "apiKey", ["read"]) : false;
  const canCreate = role ? hasPermission(role, "apiKey", ["create"]) : false;
  const canRevoke = role ? hasPermission(role, "apiKey", ["revoke"]) : false;

  const keys = useApiKeys(orgId, canRead);
  const createKey = useCreateApiKey(orgId ?? "");
  const revokeKey = useRevokeApiKey(orgId ?? "");
  const { toast } = useToast();

  const [view, setView] = useState<View>("org");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [fullAccess, setFullAccess] = useState(false);
  const [expiry, setExpiry] = useState("never");
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<ApiKeySummary | null>(null);

  const allKeys = useMemo(() => keys.data?.items ?? [], [keys.data]);
  const shown = useMemo(
    () => (view === "personal" ? allKeys.filter((k) => k.createdById && k.createdById === userId) : allKeys),
    [allKeys, view, userId],
  );

  function resetForm() {
    setName("");
    setScopes([]);
    setFullAccess(false);
    setExpiry("never");
    setFormError(null);
  }

  function toggleScope(scope: string) {
    setScopes((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  }

  async function onCreate() {
    const finalScopes = fullAccess ? ["*"] : scopes;
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (finalScopes.length === 0) {
      setFormError("Select at least one scope.");
      return;
    }
    try {
      const key = await createKey.mutateAsync({
        name: name.trim(),
        scopes: finalScopes,
        expiresAt: expiryFromPreset(expiry),
      });
      setCreating(false);
      resetForm();
      setCreated(key);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create key.");
    }
  }

  async function onRevoke() {
    if (!toRevoke) return;
    try {
      await revokeKey.mutateAsync(toRevoke.id);
      toast("Key revoked.", "success");
      setToRevoke(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not revoke key.", "error");
    }
  }

  async function copyToken() {
    if (!created) return;
    await navigator.clipboard.writeText(created.token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view API keys.</Alert>;
  }

  const isPersonal = view === "personal";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-line-soft bg-panel-2 p-0.5" role="tablist" aria-label="Key scope">
          {(
            [
              ["org", "Organization keys"],
              ["personal", "Personal access tokens"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={cn(
                "rounded px-3 py-1.5 text-xs transition-colors",
                view === value ? "bg-panel text-text" : "text-muted hover:text-text",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {canCreate ? (
          <Button size="sm" onClick={() => { resetForm(); setCreating(true); }}>
            <Plus className="size-4" /> {isPersonal ? "New token" : "New key"}
          </Button>
        ) : null}
      </div>

      <p className="text-sm text-muted">
        {isPersonal
          ? "Personal access tokens are API keys you created. They act with the organization's scopes you grant."
          : "API keys authenticate programmatic access to this organization. Scope each key to least privilege."}
      </p>

      {keys.isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : shown.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <KeyRound className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">
            {isPersonal ? "No personal access tokens" : "No API keys yet"}
          </p>
          {canCreate ? (
            <Button size="sm" className="mt-1" onClick={() => { resetForm(); setCreating(true); }}>
              <Plus className="size-4" /> {isPersonal ? "New token" : "New key"}
            </Button>
          ) : null}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Scopes</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Last used</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canRevoke ? <th className="px-4 py-3 text-right font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {shown.map((key) => {
                  const status = apiKeyStatus(key);
                  const meta = apiKeyStatusMeta(status);
                  return (
                    <tr key={key.id} className="hover:bg-panel-2/50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-text">{key.name}</span>
                        <p className="font-[family-name:var(--font-mono)] text-xs text-muted">{key.prefix}…</p>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {key.scopes.slice(0, 3).map((s) => (
                            <Badge key={s} tone="muted">{s}</Badge>
                          ))}
                          {key.scopes.length > 3 ? (
                            <Badge tone="muted">+{key.scopes.length - 3}</Badge>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDateTime(key.createdAt)}</td>
                      <td className="px-4 py-3 text-muted">
                        {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      {canRevoke ? (
                        <td className="px-4 py-3 text-right">
                          {status !== "revoked" ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setToRevoke(key)}
                              aria-label={`Revoke ${key.name}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create */}
      <Modal
        open={creating}
        title={isPersonal ? "New personal access token" : "New API key"}
        onClose={() => setCreating(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="k-name">Name</Label>
            <Input id="k-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="CI pipeline" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="k-expiry">Expiration</Label>
            <Select id="k-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
              {EXPIRY_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>Scopes</Label>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={fullAccess}
                onChange={(e) => setFullAccess(e.target.checked)}
                className="size-4 rounded border-line bg-panel-2 accent-brand"
              />
              Full access (<span className="font-[family-name:var(--font-mono)]">*</span>)
            </label>
            {!fullAccess ? (
              <div className="max-h-56 overflow-y-auto rounded-md border border-line-soft p-3">
                {SCOPE_GROUPS.map((group) => (
                  <div key={group.resource} className="mb-3 last:mb-0">
                    <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">
                      {group.resource}
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {group.scopes.map((scope) => (
                        <label key={scope} className="flex items-center gap-1.5 text-xs text-text">
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            onChange={() => toggleScope(scope)}
                            className="size-3.5 rounded border-line bg-panel-2 accent-brand"
                          />
                          <span className="font-[family-name:var(--font-mono)]">{scope}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {formError ? <Alert tone="error">{formError}</Alert> : null}
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button onClick={onCreate} loading={createKey.isPending}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Reveal once */}
      <Modal
        open={created !== null}
        title="Copy your key now"
        description="This is the only time the full key is shown."
        onClose={() => setCreated(null)}
      >
        <div className="flex flex-col gap-4">
          <Alert tone="warning">
            Store this secret somewhere safe. You won&apos;t be able to see it again.
          </Alert>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={created?.token ?? ""}
              className="font-[family-name:var(--font-mono)] text-xs"
            />
            <Button type="button" variant="secondary" size="sm" onClick={copyToken} aria-label="Copy key">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={() => setCreated(null)}>Done</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(toRevoke)}
        title="Revoke key?"
        description={toRevoke ? `"${toRevoke.name}" will stop working immediately.` : undefined}
        confirmLabel="Revoke key"
        loading={revokeKey.isPending}
        onConfirm={onRevoke}
        onCancel={() => setToRevoke(null)}
      />
    </div>
  );
}
