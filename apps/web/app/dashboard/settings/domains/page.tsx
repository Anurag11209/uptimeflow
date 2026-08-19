"use client";

import { useState, type FormEvent } from "react";
import { Globe, RefreshCw, Trash2, Lock } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { useStatusPages } from "@/lib/status-pages";
import { hasPermission, isValidDomain } from "@backend-uptime/shared";
import {
  addCustomDomain,
  removeCustomDomain,
  sslMeta,
  useCustomDomains,
  useInvalidateCustomDomains,
  verificationMeta,
  verifyCustomDomain,
  type CustomDomain,
  type DnsRecord,
} from "@/lib/custom-domains";

export default function CustomDomainsPage() {
  const { data: activeOrg, isPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "statusPage", ["read"]) : false;
  const canManage = role ? hasPermission(role, "statusPage", ["create", "update", "delete"]) : false;

  const domains = useCustomDomains(orgId, canRead);
  const statusPagesQuery = useStatusPages(orgId, canRead);
  const invalidate = useInvalidateCustomDomains();
  const { toast } = useToast();

  const [statusPageId, setStatusPageId] = useState("");
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [upgradeNeeded, setUpgradeNeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<CustomDomain | null>(null);
  const [deleting, setDeleting] = useState(false);

  const statusPages = statusPagesQuery.data?.items ?? [];

  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (!canRead) return <Alert tone="warning">You do not have permission to view custom domains.</Alert>;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    if (!statusPageId) {
      setError("Please select a status page to bind to this domain.");
      return;
    }
    if (!isValidDomain(domain)) {
      setError("Enter a valid domain, e.g. status.acme.com.");
      return;
    }
    setBusy(true);
    setError(null);
    setUpgradeNeeded(false);
    try {
      await addCustomDomain(orgId, { statusPageId: statusPageId.trim(), domain: domain.trim() });
      toast(`Custom domain "${domain.trim()}" added.`, "success");
      setDomain("");
      setStatusPageId("");
      invalidate(orgId);
    } catch (err) {
      if (err instanceof ApiError && err.code === "payment_required") {
        setUpgradeNeeded(true);
        setError(err.message);
      } else {
        setError(err instanceof ApiError ? err.message : "Could not add domain.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function onVerify(id: string) {
    if (!orgId) return;
    setBusyId(id);
    try {
      await verifyCustomDomain(orgId, id);
      toast("Verification check requested.", "info");
      invalidate(orgId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Verification check failed.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function onConfirmRemove() {
    if (!orgId || !toDelete) return;
    setDeleting(true);
    try {
      await removeCustomDomain(orgId, toDelete.id);
      toast(`Custom domain "${toDelete.domain}" removed.`, "success");
      setToDelete(null);
      invalidate(orgId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove domain.", "error");
    } finally {
      setDeleting(false);
    }
  }

  const items = domains.data?.items ?? [];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">Custom domains</h1>
        <p className="mt-1 text-sm text-muted">
          Serve a status page on your own domain (e.g. status.acme.com) with automatic SSL.
        </p>
      </header>

      {upgradeNeeded ? (
        <Alert tone="warning">
          <span className="flex items-center gap-2">
            <Lock className="size-4" /> Custom domains are a paid feature. Upgrade your plan to enable them.
          </span>
        </Alert>
      ) : null}

      <Card className="p-5">
        {domains.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted">No custom domains yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {items.map((d) => (
              <DomainRow
                key={d.id}
                domain={d}
                canManage={canManage}
                busy={busyId === d.id}
                onVerify={() => onVerify(d.id)}
                onRemove={() => setToDelete(d)}
              />
            ))}
          </ul>
        )}

        {canManage ? (
          <form onSubmit={onAdd} className="mt-4 flex flex-col gap-3 border-t border-line-soft pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cd-domain">Domain</Label>
                <Input
                  id="cd-domain"
                  name="domain"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  required
                  placeholder="status.acme.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cd-page">Status page</Label>
                <Select
                  id="cd-page"
                  name="statusPageId"
                  value={statusPageId}
                  onChange={(e) => setStatusPageId(e.target.value)}
                  required
                >
                  <option value="">Select a status page…</option>
                  {statusPages.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name} ({sp.slug})
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {error ? <Alert tone="error">{error}</Alert> : null}
            <div>
              <Button type="submit" size="sm" loading={busy}>
                <Globe className="size-3.5" /> Add domain
              </Button>
            </div>
          </form>
        ) : null}
      </Card>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Remove custom domain?"
        description={
          toDelete
            ? `Are you sure you want to remove "${toDelete.domain}"? DNS routing and SSL for this domain will be disabled.`
            : undefined
        }
        confirmLabel="Remove domain"
        tone="danger"
        loading={deleting}
        onConfirm={onConfirmRemove}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function DnsRow({ record }: { record: DnsRecord }) {
  return (
    <div className="grid grid-cols-[4rem_1fr] gap-2 break-all font-[family-name:var(--font-mono)] text-xs">
      <span className="text-muted">{record.type}</span>
      <span className="text-text">{record.name}</span>
      <span className="text-muted">value</span>
      <span className="text-text">{record.value}</span>
    </div>
  );
}

function DomainRow({
  domain,
  canManage,
  busy,
  onVerify,
  onRemove,
}: {
  domain: CustomDomain;
  canManage: boolean;
  busy: boolean;
  onVerify: () => void;
  onRemove: () => void;
}) {
  const vMeta = verificationMeta(domain.verificationStatus);
  const sMeta = sslMeta(domain.sslStatus);
  return (
    <li className="flex flex-col gap-3 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Globe className="size-4 text-muted" />
          <span className="font-medium text-text">{domain.domain}</span>
          <Badge tone={vMeta.tone}>{vMeta.label}</Badge>
          <Badge tone={sMeta.tone}>{sMeta.label}</Badge>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={onVerify} loading={busy}>
              <RefreshCw className="size-3.5" /> Check now
            </Button>
            <Button variant="danger" size="sm" onClick={onRemove} aria-label={`Remove domain ${domain.domain}`}>
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>

      {domain.verificationStatus !== "VERIFIED" ? (
        <div className="rounded-md border border-line-soft bg-ink/40 p-3">
          <p className="mb-2 text-xs text-muted">
            Add these DNS records at your provider, then choose “Check now”. Propagation can take a few minutes.
          </p>
          <div className="flex flex-col gap-2">
            <DnsRow record={domain.dns.txtRecord} />
            <DnsRow record={domain.dns.cnameRecord} />
          </div>
          {domain.lastCheckError ? <p className="mt-2 text-xs text-down">{domain.lastCheckError}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
