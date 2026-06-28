"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart } from "@/components/charts/area-chart";
import { AvailabilityChart } from "@/components/charts/availability-chart";
import { ChartCard } from "@/components/analytics/chart-card";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import type { ChartPoint } from "@/lib/chart";
import {
  bucketDaily,
  useAnalyticsTimeseries,
  type Bucket,
  type DailyPoint,
} from "@/lib/analytics";

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
];

function toPoints(points: DailyPoint[], pick: (p: DailyPoint) => number | null): ChartPoint[] {
  return points
    .map((p, i) => ({ t: i, value: pick(p) }))
    .filter((p): p is ChartPoint => p.value !== null);
}

export function MonitoringSection({ orgId, days }: { orgId: string; days: number }) {
  const { data, isPending, error } = useAnalyticsTimeseries(orgId, days);
  const [bucket, setBucket] = useState<Bucket>("day");

  const points = useMemo(() => bucketDaily(data?.points ?? [], bucket), [data, bucket]);

  const uptimePoints = useMemo(() => toPoints(points, (p) => p.uptimePct), [points]);
  const responsePoints = useMemo(() => toPoints(points, (p) => p.avgResponseMs), [points]);
  const failurePoints = useMemo(
    () => toPoints(points, (p) => (p.totalChecks > 0 ? (p.failedChecks / p.totalChecks) * 100 : null)),
    [points],
  );
  const availabilityDays = useMemo(
    () =>
      points
        .filter((p) => p.uptimePct !== null)
        .map((p) => ({ day: p.day, uptimePct: p.uptimePct as number })),
    [points],
  );

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load monitoring analytics."}
      </Alert>
    );
  }

  const toggle = (
    <div className="flex rounded-md border border-line-soft bg-panel-2 p-0.5" role="tablist" aria-label="Bucket">
      {BUCKETS.map((b) => (
        <button
          key={b.value}
          role="tab"
          aria-selected={bucket === b.value}
          onClick={() => setBucket(b.value)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            bucket === b.value ? "bg-panel text-text" : "text-muted hover:text-text",
          )}
        >
          {b.label}
        </button>
      ))}
    </div>
  );

  if (isPending) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-56" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Uptime over time" description="Availability %, weighted by checks" right={toggle}>
          <AreaChart points={uptimePoints} label="Uptime" unit="%" tone="up" max={100} />
        </ChartCard>
        <ChartCard title="Response time trend" description="Average response time">
          <AreaChart points={responsePoints} label="Response time" unit="ms" tone="brand" />
        </ChartCard>
        <ChartCard title="Failure rate" description="Failed checks as a % of total">
          <AreaChart points={failurePoints} label="Failure rate" unit="%" tone="down" />
        </ChartCard>
        <ChartCard title="Availability" description="Per-bucket uptime distribution">
          <AvailabilityChart days={availabilityDays} />
        </ChartCard>
      </div>
    </div>
  );
}
