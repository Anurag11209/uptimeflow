"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Check, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { useEscalationPolicies } from "@/lib/monitors";
import { REGION_OPTIONS, useOrgSettings, useUpdateOrgSettings } from "@/lib/organization";
import {
  buildOrgSettingsPayload,
  formFromOrgSettings,
  isFormValid,
  validateOrgSettingsForm,
  type OrgSettingsFormErrors,
  type OrgSettingsFormState,
} from "@/lib/organization-form";
import { hasPermission } from "@backend-uptime/shared";

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? <p className="text-xs text-down">{error}</p> : null}
    </div>
  );
}

export default function OrganizationSettingsPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "organization", ["read"]) : false;
  const canUpdate = role ? hasPermission(role, "organization", ["update"]) : false;

  const settings = useOrgSettings(orgId, canRead);
  const policies = useEscalationPolicies(orgId, canRead);
  const update = useUpdateOrgSettings(orgId ?? "");
  const { toast } = useToast();

  const [state, setState] = useState<OrgSettingsFormState | null>(null);
  const [errors, setErrors] = useState<OrgSettingsFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Hydrate the form once settings load (and keep it editable thereafter).
  useEffect(() => {
    if (settings.data && state === null) setState(formFromOrgSettings(settings.data));
  }, [settings.data, state]);

  function set<K extends keyof OrgSettingsFormState>(key: K, value: OrgSettingsFormState[K]) {
    setState((s) => {
      if (!s) return s;
      const next = { ...s, [key]: value };
      if (submitted) setErrors(validateOrgSettingsForm(next));
      return next;
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!state) return;
    setSubmitted(true);
    setServerError(null);
    const validation = validateOrgSettingsForm(state);
    setErrors(validation);
    if (!isFormValid(validation)) return;
    try {
      await update.mutateAsync(buildOrgSettingsPayload(state));
      toast("Organization updated.", "success");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not update organization.");
    }
  }

  async function copyId() {
    if (!orgId) return;
    await navigator.clipboard.writeText(orgId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (orgPending || (settings.isPending && canRead)) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view organization settings.</Alert>;
  }

  if (settings.error) {
    return (
      <Alert tone="error">
        {settings.error instanceof ApiError ? settings.error.message : "Could not load settings."}
      </Alert>
    );
  }

  if (!state) return null;

  return (
    <form onSubmit={onSubmit} className="flex max-w-2xl flex-col gap-6" noValidate>
      <Card className="p-5">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-sm font-semibold text-text">
          Profile
        </h2>
        <div className="flex flex-col gap-4">
          <Field label="Organization name" htmlFor="name" error={errors.name}>
            <Input
              id="name"
              value={state.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={!canUpdate}
            />
          </Field>
          <Field
            label="Slug"
            htmlFor="slug"
            error={errors.slug}
            hint="Used in URLs. Lowercase letters, numbers, and hyphens."
          >
            <Input
              id="slug"
              value={state.slug}
              onChange={(e) => set("slug", e.target.value)}
              disabled={!canUpdate}
              className="font-[family-name:var(--font-mono)]"
            />
          </Field>
          <Field label="Logo URL" htmlFor="logo" error={errors.logo}>
            <Input
              id="logo"
              value={state.logo}
              onChange={(e) => set("logo", e.target.value)}
              placeholder="https://acme.com/logo.svg"
              disabled={!canUpdate}
            />
          </Field>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-sm font-semibold text-text">
          Defaults
        </h2>
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Timezone" htmlFor="timezone" error={errors.timezone} hint="e.g. UTC, America/New_York">
              <Input
                id="timezone"
                value={state.timezone}
                onChange={(e) => set("timezone", e.target.value)}
                placeholder="UTC"
                disabled={!canUpdate}
                className="font-[family-name:var(--font-mono)]"
              />
            </Field>
            <Field label="Default region" htmlFor="defaultRegion">
              <Select
                id="defaultRegion"
                value={state.defaultRegion}
                onChange={(e) => set("defaultRegion", e.target.value as OrgSettingsFormState["defaultRegion"])}
                disabled={!canUpdate}
              >
                <option value="">No default</option>
                {REGION_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Billing contact" htmlFor="billingContact" error={errors.billingContact}>
              <Input
                id="billingContact"
                type="email"
                value={state.billingContact}
                onChange={(e) => set("billingContact", e.target.value)}
                placeholder="billing@acme.com"
                disabled={!canUpdate}
              />
            </Field>
            <Field label="Default alert policy" htmlFor="defaultAlertPolicyId">
              <Select
                id="defaultAlertPolicyId"
                value={state.defaultAlertPolicyId}
                onChange={(e) => set("defaultAlertPolicyId", e.target.value)}
                disabled={!canUpdate}
              >
                <option value="">None</option>
                {(policies.data?.items ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="mb-4 font-[family-name:var(--font-display)] text-sm font-semibold text-text">
          Identifiers
        </h2>
        <Field label="Organization ID" htmlFor="org-id" hint="Use this when contacting support.">
          <div className="flex items-center gap-2">
            <Input
              id="org-id"
              value={orgId ?? ""}
              readOnly
              className="font-[family-name:var(--font-mono)] text-xs"
            />
            <Button type="button" variant="secondary" size="sm" onClick={copyId} aria-label="Copy organization ID">
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
          </div>
        </Field>
      </Card>

      {serverError ? <Alert tone="error">{serverError}</Alert> : null}

      {canUpdate ? (
        <div className="flex justify-end">
          <Button type="submit" loading={update.isPending}>
            Save changes
          </Button>
        </div>
      ) : (
        <Alert tone="info">You have read-only access to organization settings.</Alert>
      )}
    </form>
  );
}
