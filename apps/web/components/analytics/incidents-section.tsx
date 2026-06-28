"use client";

import { useMemo } from "react";
import { AlertTriangle, Clock, Hash } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/incidents/stat-tile";
import { BarChart } from "@/components/charts/bar-chart";
import { DonutChart } from "@/components/charts/donut-chart";
import { ChartCard } from "@/components/analytics/chart-card";
import { ApiError } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  formatDuration,
  severityMeta,
  useAnalyticsIncidents,
  type IncidentSeverity,
} from "@/lib/analytics";

const SEVERITY_COLOR: Record<IncidentSeverity, string> = {
  CRITICAL: "var(--color-down)",
  MAJOR: "#ff8a3d",
  MINOR: "var(--color-brand)",
  WARNING: "var(--color-muted)",
};

export function IncidentsSection({ orgId, days }: { orgId: string; days: number }) {
  const { data, isPending, error } = useAnalyticsIncidents(orgId, days);

  const severitySlices = useMemo(
    () =>
      (data?.bySeverity ?? []).map((s) => ({
        label: severityMeta(s.severity).label,
        value: s.count,
        color: SEVERITY_COLOR[s.severity],
      })),
    [data],
  );
  const causeSlices = useMemo(
    () => (data?.byCause ?? []).slice(0, 6).map((c) => ({ label: c.cause, value: c.count })),
    [data],
  );
  const frequencyBars = useMemo(
    () => (data?.monthly ?? []).map((m) => ({ label: m.month.slice(5), value: m.count, title: `${m.month}: ${m.count} incidents` })),
    [data],
  );
  const durationBars = useMemo(
    () =>
      (data?.monthly ?? []).map((m) => ({
        label: m.month.slice(5),
        value: Math.round((m.avgDurationSec ?? 0) / 60),
        title: `${m.month}: avg ${formatDuration(m.avgDurationSec)}`,
      })),
    [data],
  );

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load incident analytics."}
      </Alert>
    );
  }

  if (isPending || !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (data.total === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted">
        No incidents in this range. 🎉
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile icon={Hash} label="Total incidents" value={data.total} />
        <StatTile icon={Clock} label="Avg resolution" value={formatDuration(data.avgDurationSec)} />
        <StatTile
          icon={AlertTriangle}
          label="Most common cause"
          value={data.byCause[0]?.cause ?? "—"}
          hint={data.byCause[0] ? `${data.byCause[0].count} incidents` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Incident frequency" description="Incidents opened per month">
          <BarChart data={frequencyBars} format={(v) => `${v}`} tone="brand" />
        </ChartCard>
        <ChartCard title="Resolution time" description="Average duration per month (minutes)">
          <BarChart data={durationBars} format={(v) => `${v}m`} tone="down" />
        </ChartCard>
        <ChartCard title="Severity distribution">
          <DonutChart slices={severitySlices} centerLabel={String(data.total)} centerSubLabel="total" />
        </ChartCard>
        <ChartCard title="Root cause distribution">
          <DonutChart slices={causeSlices} />
        </ChartCard>
      </div>

      {data.longest.length > 0 ? (
        <Card className="overflow-hidden">
          <div className="border-b border-line-soft p-4 text-sm font-medium text-text">
            Longest incidents
          </div>
          <ul className="divide-y divide-line-soft">
            {data.longest.map((inc) => (
              <li key={inc.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-text">{inc.title}</p>
                  <p className="text-xs text-muted">{formatDate(inc.startedAt)}</p>
                </div>
                <span className="shrink-0 font-[family-name:var(--font-mono)] text-sm text-down">
                  {formatDuration(inc.durationSec)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
