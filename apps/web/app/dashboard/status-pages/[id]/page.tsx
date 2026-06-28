"use client";

import { use, useState } from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import { ComponentsTab } from "@/components/status-pages/components-tab";
import { IncidentsTab, MaintenanceTab } from "@/components/status-pages/incidents-tab";
import { OverviewTab } from "@/components/status-pages/overview-tab";
import { SettingsTab } from "@/components/status-pages/settings-tab";
import { SubscribersTab } from "@/components/status-pages/subscribers-tab";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { useStatusPage, visibilityMeta } from "@/lib/status-pages";
import { cn } from "@/lib/utils";
import { hasPermission } from "@backend-uptime/shared";

const TABS = [
  "Overview",
  "Components",
  "Incidents",
  "Maintenance",
  "Subscribers",
  "Settings",
] as const;
type Tab = (typeof TABS)[number];

const PUBLIC_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "";

export default function StatusPageDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "statusPage", ["read"]) : false;
  const canManage = role
    ? hasPermission(role, "statusPage", ["create", "update", "delete"])
    : false;

  const { data: page, isPending, error } = useStatusPage(orgId, id, canRead);
  const [tab, setTab] = useState<Tab>("Overview");

  if (orgPending || (isPending && canRead)) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view status pages.</Alert>;
  }

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError && error.status === 404
          ? "This status page no longer exists."
          : error instanceof ApiError
            ? error.message
            : "Could not load this status page."}
      </Alert>
    );
  }

  if (!page || !orgId) return null;

  const vis = visibilityMeta(page.visibility);
  const publicUrl = page.customDomain
    ? `https://${page.customDomain}`
    : `${PUBLIC_BASE}/status/${page.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <ButtonLink href="/dashboard/status-pages" variant="ghost" size="sm" className="mb-2 -ml-2">
          <ArrowLeft className="size-4" /> Status pages
        </ButtonLink>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
              {page.name}
            </h1>
            <Badge tone={vis.tone}>{vis.label}</Badge>
          </div>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-sm text-text transition-colors hover:border-brand/60 hover:text-brand"
          >
            View public page <ExternalLink className="size-3.5" />
          </a>
        </div>
        <p className="mt-1 font-[family-name:var(--font-mono)] text-xs text-muted">
          /status/{page.slug}
        </p>
      </div>

      <div
        role="tablist"
        aria-label="Status page sections"
        className="flex flex-wrap gap-1 border-b border-line-soft"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "relative -mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t
                ? "border-brand text-text"
                : "border-transparent text-muted hover:text-text",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div>
        {tab === "Overview" ? <OverviewTab orgId={orgId} page={page} /> : null}
        {tab === "Components" ? (
          <ComponentsTab orgId={orgId} pageId={page.id} canManage={canManage} />
        ) : null}
        {tab === "Incidents" ? (
          <IncidentsTab orgId={orgId} pageId={page.id} canManage={canManage} />
        ) : null}
        {tab === "Maintenance" ? (
          <MaintenanceTab orgId={orgId} pageId={page.id} canManage={canManage} />
        ) : null}
        {tab === "Subscribers" ? <SubscribersTab orgId={orgId} pageId={page.id} /> : null}
        {tab === "Settings" ? (
          <SettingsTab orgId={orgId} page={page} canManage={canManage} />
        ) : null}
      </div>
    </div>
  );
}
