"use client";

import { useMemo } from "react";
import { Gauge, Rabbit, Turtle } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/incidents/stat-tile";
import { Heatmap, latencyHeatColor } from "@/components/charts/heatmap";
import { ChartCard } from "@/components/analytics/chart-card";
import { ApiError } from "@/lib/api";
import { formatResponseMs, regionLabel } from "@/lib/monitors";
import { formatDate } from "@/lib/format";
import {
  formatPct,
  uptimeBand,
  useAnalyticsRegions,
  type RegionStat,
} from "@/lib/analytics";

function fastest(regions: RegionStat[]): RegionStat | null {
  const withLatency = regions.filter((r) => r.avgResponseMs !== null);
  if (withLatency.length === 0) return null;
  return withLatency.reduce((a, b) => (a.avgResponseMs! <= b.avgResponseMs! ? a : b));
}

function slowest(regions: RegionStat[]): RegionStat | null {
  const withLatency = regions.filter((r) => r.avgResponseMs !== null);
  if (withLatency.length === 0) return null;
  return withLatency.reduce((a, b) => (a.avgResponseMs! >= b.avgResponseMs! ? a : b));
}

export function RegionalSection({ orgId, days }: { orgId: string; days: number }) {
  const { data, isPending, error } = useAnalyticsRegions(orgId, days);
  const regions = useMemo(() => data?.regions ?? [], [data]);

  const fast = useMemo(() => fastest(regions), [regions]);
  const slow = useMemo(() => slowest(regions), [regions]);
  const worstLatency = useMemo(
    () => Math.max(0, ...regions.map((r) => r.avgResponseMs ?? 0)),
    [regions],
  );

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load regional analytics."}
      </Alert>
    );
  }

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }

  if (regions.length === 0) {
    return (
      <Card className="p-10 text-center text-sm text-muted">
        No regional data for this range. Regional analytics appear once per-region checks have been
        recorded.
      </Card>
    );
  }

  const latencyCells = regions.map((r) => ({
    id: r.region,
    title: `${regionLabel(r.region)}: ${formatResponseMs(r.avgResponseMs)}`,
    value: r.avgResponseMs,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          icon={Rabbit}
          label="Fastest region"
          value={fast ? regionLabel(fast.region) : "—"}
          hint={fast ? formatResponseMs(fast.avgResponseMs) : undefined}
          tone="up"
        />
        <StatTile
          icon={Turtle}
          label="Slowest region"
          value={slow ? regionLabel(slow.region) : "—"}
          hint={slow ? formatResponseMs(slow.avgResponseMs) : undefined}
          tone="brand"
        />
        <StatTile icon={Gauge} label="Regions reporting" value={regions.length} />
      </div>

      <ChartCard title="Latency heat map" description="Average response time by region (greener is faster)">
        <Heatmap cells={latencyCells} color={latencyHeatColor(worstLatency)} columns={Math.min(8, regions.length)} />
        <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(8, regions.length)}, minmax(0, 1fr))` }}>
          {regions.map((r) => (
            <span key={r.region} className="truncate text-center text-[10px] text-muted" title={regionLabel(r.region)}>
              {regionLabel(r.region)}
            </span>
          ))}
        </div>
      </ChartCard>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                <th className="px-4 py-3 font-medium">Region</th>
                <th className="px-4 py-3 font-medium">Avg latency</th>
                <th className="px-4 py-3 font-medium">Success rate</th>
                <th className="px-4 py-3 font-medium">Failed checks</th>
                <th className="px-4 py-3 font-medium">Last outage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {regions.map((r) => (
                <tr key={r.region} className="hover:bg-panel-2/50">
                  <td className="px-4 py-3 font-medium text-text">{regionLabel(r.region)}</td>
                  <td className="px-4 py-3 text-muted">{formatResponseMs(r.avgResponseMs)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={uptimeBand(r.successRatePct)}>{formatPct(r.successRatePct)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.failedChecks.toLocaleString()}</td>
                  <td className="px-4 py-3 text-muted">{r.lastOutageAt ? formatDate(r.lastOutageAt) : "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
