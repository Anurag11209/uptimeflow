"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toast";
import { StatusPageForm } from "@/components/status-pages/status-page-form";
import { ApiError } from "@/lib/api";
import {
  addCustomDomain,
  removeCustomDomain,
  sslMeta,
  useCustomDomains,
  useInvalidateCustomDomains,
  verifyCustomDomain,
  verificationMeta,
  type CustomDomain,
} from "@/lib/custom-domains";
import {
  useDeleteStatusPage,
  useUpdateStatusPage,
  type StatusPagePayload,
  type StatusPageSummary,
} from "@/lib/status-pages";
import { formFromStatusPage } from "@/lib/status-page-form";

export function SettingsTab({
  orgId,
  page,
  canManage,
}: {
  orgId: string;
  page: StatusPageSummary;
  canManage: boolean;
}) {
  const router = useRouter();
  const updatePage = useUpdateStatusPage(orgId);
  const deletePage = useDeleteStatusPage(orgId);
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function onSubmit(payload: StatusPagePayload) {
    setServerError(null);
    try {
      await updatePage.mutateAsync({ id: page.id, payload });
      toast("Status page updated.", "success");
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not update status page.");
    }
  }

  async function onDelete() {
    try {
      await deletePage.mutateAsync(page.id);
      toast("Status page deleted.", "success");
      router.push("/dashboard/status-pages");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete status page.", "error");
    }
  }

  if (!canManage) {
    return <Alert tone="warning">You do not have permission to edit this status page.</Alert>;
  }

  return (
    <div className="flex flex-col gap-8">
      <StatusPageForm
        key={page.updatedAt}
        initial={formFromStatusPage(page)}
        submitLabel="Save changes"
        pending={updatePage.isPending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => router.push("/dashboard/status-pages")}
      />

      <CustomDomainsSection orgId={orgId} pageId={page.id} />

      <Card className="border-down/30 p-5">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-down">
          Danger zone
        </h2>
        <p className="mt-1 text-xs text-muted">
          Deleting a status page removes its components, incidents, and subscribers permanently.
        </p>
        <Button variant="danger" size="sm" className="mt-4" onClick={() => setConfirmDelete(true)}>
          <Trash2 className="size-3.5" /> Delete status page
        </Button>
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete status page?"
        description={`"${page.name}" and all of its data will be permanently removed.`}
        confirmLabel="Delete status page"
        loading={deletePage.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function CustomDomainsSection({ orgId, pageId }: { orgId: string; pageId: string }) {
  const { data, isPending } = useCustomDomains(orgId);
  const invalidate = useInvalidateCustomDomains();
  const { toast } = useToast();
  const [domain, setDomain] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const domains = useMemo(
    () => (data?.items ?? []).filter((d) => d.statusPageId === pageId),
    [data, pageId],
  );

  async function onAdd() {
    if (!domain.trim()) return;
    setAdding(true);
    try {
      await addCustomDomain(orgId, { statusPageId: pageId, domain: domain.trim() });
      toast("Domain added. Add the DNS records below to verify.", "success");
      setDomain("");
      invalidate(orgId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not add domain.", "error");
    } finally {
      setAdding(false);
    }
  }

  async function onVerify(d: CustomDomain) {
    setBusyId(d.id);
    try {
      const result = await verifyCustomDomain(orgId, d.id);
      toast(
        result.verificationStatus === "VERIFIED"
          ? "Domain verified."
          : "Not verified yet — DNS may still be propagating.",
        result.verificationStatus === "VERIFIED" ? "success" : "info",
      );
      invalidate(orgId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not verify domain.", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function onRemove(d: CustomDomain) {
    setBusyId(d.id);
    try {
      await removeCustomDomain(orgId, d.id);
      toast("Domain removed.", "success");
      invalidate(orgId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove domain.", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-text">
        Custom domains
      </h2>
      <p className="mt-0.5 text-xs text-muted">
        Serve this status page on your own hostname (status.acme.com).
      </p>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="new-domain">Add a domain</Label>
          <Input
            id="new-domain"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="status.acme.com"
            className="font-[family-name:var(--font-mono)]"
          />
        </div>
        <Button onClick={onAdd} loading={adding} disabled={!domain.trim()}>
          Add
        </Button>
      </div>

      {isPending ? (
        <p className="mt-4 text-sm text-muted">Loading domains…</p>
      ) : domains.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No custom domains connected.</p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {domains.map((d) => {
            const vm = verificationMeta(d.verificationStatus);
            const sm = sslMeta(d.sslStatus);
            return (
              <div key={d.id} className="rounded-md border border-line-soft bg-panel-2 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-[family-name:var(--font-mono)] text-sm text-text">
                    {d.domain}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge tone={vm.tone}>
                      {d.verificationStatus === "VERIFIED" ? (
                        <CheckCircle2 className="size-3" />
                      ) : null}
                      {vm.label}
                    </Badge>
                    <Badge tone={sm.tone}>{sm.label}</Badge>
                  </div>
                </div>

                {d.verificationStatus !== "VERIFIED" ? (
                  <div className="mt-3 flex flex-col gap-2 font-[family-name:var(--font-mono)] text-xs text-muted">
                    <DnsRow record={d.dns.txtRecord} />
                    <DnsRow record={d.dns.cnameRecord} />
                    {d.lastCheckError ? (
                      <p className="text-down">Last check: {d.lastCheckError}</p>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-3 flex gap-2">
                  {d.verificationStatus !== "VERIFIED" ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onVerify(d)}
                      loading={busyId === d.id}
                    >
                      <RefreshCw className="size-3.5" /> Verify
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemove(d)}
                    disabled={busyId === d.id}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function DnsRow({ record }: { record: { type: string; name: string; value: string } }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <span className="text-brand">{record.type}</span>
      <span className="text-text">{record.name}</span>
      <span className="break-all">{record.value}</span>
    </div>
  );
}
