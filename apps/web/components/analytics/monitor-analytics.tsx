"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AreaChart } from "@/components/charts/area-chart";
import { ChartCard } from "@/components/analytics/chart-card";
import { ApiError } from "@/lib/api";
import type { ChartPoint } from "@/lib/chart";
import { formatResponseMs, regionLabel } from "@/lib/monitors";
import {
  formatDuration,
  formatPct,
  RANGE_OPTIONS,
  uptimeBand,
  useMonitorAnalytics,
  type DailyPoint,
} from "@/lib/analytics";

function toPoints(points: DailyPoint[], pick: (p: DailyPoint) => number | null): ChartPoint[] {
  return points
    .map((p, i) => ({ t: i, value: pick(p) }))
    .filter((p): p is ChartPoint => p.value !== null);
}

/**
 * Long-horizon analytics for a single monitor, driven by the daily rollup —
 * complements the recent-checks latency/availability charts already on the
 * monitor page with uptime trend, p95, downtime, and a regional comparison.
 */
export function MonitorAnalytics({ orgId, monitorId }: { orgId: string; monitorId: string }) {
  const [days, setDays] = useState(30);
  const { data, isPending, error } = useMonitorAnalytics(orgId, monitorId, days);

  const uptimePoints = useMemo(() => toPoints(data?.daily ?? [], (p) => p.uptimePct), [data]);
  const responsePoints = useMemo(() => toPoints(data?.daily ?? [], (p) => p.avgResponseMs), [data]);

  const rangeSelect = (
    <div className="w-32">
      <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))} aria-label="Analytics range">
        {RANGE_OPTIONS.map((r) => (
          <option key={r.days} value={r.days}>
            {r.label}
          </option>
        ))}
      </Select>
    </div>
  );

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load analytics for this monitor."}
      </Alert>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-text">
          Analytics
        </h2>
        {rangeSelect}
      </div>

      {isPending || !data ? (
        <Skeleton className="h-56" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <MiniStat label="Uptime" value={formatPct(data.uptimePct)} tone={uptimeBand(data.uptimePct)} />
            <MiniStat label="Avg response" value={formatResponseMs(data.avgResponseMs)} />
            <MiniStat label="p95 response" value={formatResponseMs(data.p95ResponseMs)} />
            <MiniStat label="Downtime" value={formatDuration(data.downtimeSec)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Uptime trend">
              <AreaChart points={uptimePoints} label="Uptime" unit="%" tone="up" max={100} />
            </ChartCard>
            <ChartCard title="Response time">
              <AreaChart points={responsePoints} label="Response time" unit="ms" tone="brand" />
            </ChartCard>
          </div>

          {data.regions.length > 0 ? (
            <ChartCard title="Regional comparison">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                      <th className="py-2 font-medium">Region</th>
                      <th className="py-2 font-medium">Avg latency</th>
                      <th className="py-2 font-medium">Success rate</th>
                      <th className="py-2 font-medium">Failed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {data.regions.map((r) => (
                      <tr key={r.region}>
                        <td className="py-2 text-text">{regionLabel(r.region)}</td>
                        <td className="py-2 text-muted">{formatResponseMs(r.avgResponseMs)}</td>
                        <td className="py-2">
                          <Badge tone={uptimeBand(r.successRatePct)}>{formatPct(r.successRatePct)}</Badge>
                        </td>
                        <td className="py-2 text-muted">{r.failedChecks.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          ) : null}
        </>
      )}
    </section>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "up" | "down" | "brand" | "muted" }) {
  const color =
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "brand" ? "text-brand" : tone === "muted" ? "text-muted" : "text-text";
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 font-[family-name:var(--font-display)] text-xl font-semibold tabular-nums ${color}`}>
        {value}
      </p>
    </Card>
  );
}
