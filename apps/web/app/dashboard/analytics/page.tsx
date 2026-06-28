"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { SummaryCards } from "@/components/analytics/summary-cards";
import { MonitoringSection } from "@/components/analytics/monitoring-section";
import { useActiveOrg } from "@/lib/queries";
import { RANGE_OPTIONS, useAnalyticsSummary } from "@/lib/analytics";
import { cn } from "@/lib/utils";
import { hasPermission } from "@backend-uptime/shared";

const SectionSkeleton = () => <Skeleton className="h-72 w-full" />;

// Code-split the heavier sub-views so the dashboard's first paint only pays for
// the Overview tab (Step 10 — lazy loading).
const RegionalSection = dynamic(
  () => import("@/components/analytics/regional-section").then((m) => m.RegionalSection),
  { loading: SectionSkeleton },
);
const IncidentsSection = dynamic(
  () => import("@/components/analytics/incidents-section").then((m) => m.IncidentsSection),
  { loading: SectionSkeleton },
);
const SlaReportSection = dynamic(
  () => import("@/components/analytics/sla-report").then((m) => m.SlaReportSection),
  { loading: SectionSkeleton },
);

const TABS = ["Overview", "Regional", "Incidents", "SLA Reports"] as const;
type Tab = (typeof TABS)[number];

export default function AnalyticsPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "monitor", ["read"]) : false;

  const [tab, setTab] = useState<Tab>("Overview");
  const [days, setDays] = useState(30);

  const summary = useAnalyticsSummary(orgId, days, canRead);

  if (orgPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view analytics.</Alert>;
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
            Analytics
          </h1>
          <p className="mt-1 text-sm text-muted">
            Infrastructure health, performance, and reliability at a glance.
          </p>
        </div>
        {tab !== "SLA Reports" ? (
          <div className="w-36">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range">
              {RANGE_OPTIONS.map((r) => (
                <option key={r.days} value={r.days}>
                  Last {r.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </header>

      <div role="tablist" aria-label="Analytics views" className="flex flex-wrap gap-1 border-b border-line-soft">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
              tab === t ? "border-brand text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {orgId ? (
        <>
          {tab === "Overview" ? (
            <div className="flex flex-col gap-6">
              <SummaryCards summary={summary.data} isPending={summary.isPending} />
              <MonitoringSection orgId={orgId} days={days} />
            </div>
          ) : null}
          {tab === "Regional" ? <RegionalSection orgId={orgId} days={days} /> : null}
          {tab === "Incidents" ? <IncidentsSection orgId={orgId} days={days} /> : null}
          {tab === "SLA Reports" ? <SlaReportSection orgId={orgId} /> : null}
        </>
      ) : null}
    </div>
  );
}
