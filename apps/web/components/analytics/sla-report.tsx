"use client";

import { useState } from "react";
import { Download, FileJson, FileText, Printer } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/incidents/stat-tile";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { downloadCsv, downloadJson, printReport, type CsvRow } from "@/lib/export";
import {
  formatDuration,
  formatPct,
  SLA_RANGES,
  uptimeBand,
  useAnalyticsSla,
  type SlaReport as SlaReportData,
} from "@/lib/analytics";
import { ShieldCheck, Timer, TrendingDown, AlertCircle } from "lucide-react";

function slaRows(report: SlaReportData): CsvRow[] {
  return report.monitors.map((m) => ({
    monitor: m.name,
    uptimePct: m.uptimePct ?? "",
    downtimeSeconds: m.downtimeSec,
    incidents: m.incidents,
  }));
}

export function SlaReportSection({ orgId }: { orgId: string }) {
  const [days, setDays] = useState(30);
  const { data, isPending, error } = useAnalyticsSla(orgId, days);

  function onCsv() {
    if (!data) return;
    downloadCsv(`sla-report-${days}d.csv`, slaRows(data), [
      "monitor",
      "uptimePct",
      "downtimeSeconds",
      "incidents",
    ]);
  }

  function onJson() {
    if (!data) return;
    downloadJson(`sla-report-${days}d.json`, data);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-md border border-line-soft bg-panel-2 p-0.5" role="tablist" aria-label="SLA range">
          {SLA_RANGES.map((r) => (
            <button
              key={r.days}
              role="tab"
              aria-selected={days === r.days}
              onClick={() => setDays(r.days)}
              className={cn(
                "rounded px-3 py-1.5 text-xs transition-colors",
                days === r.days ? "bg-panel text-text" : "text-muted hover:text-text",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="secondary" size="sm" onClick={onCsv} disabled={!data}>
            <FileText className="size-3.5" /> CSV
          </Button>
          <Button variant="secondary" size="sm" onClick={onJson} disabled={!data}>
            <FileJson className="size-3.5" /> JSON
          </Button>
          <Button variant="secondary" size="sm" onClick={printReport} disabled={!data}>
            <Printer className="size-3.5" /> PDF
          </Button>
        </div>
      </div>

      {error ? (
        <Alert tone="error">
          {error instanceof ApiError ? error.message : "Could not load the SLA report."}
        </Alert>
      ) : isPending || !data ? (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <StatTile
              icon={ShieldCheck}
              label="SLA"
              value={formatPct(data.slaPct)}
              hint={`Last ${data.rangeDays} days`}
              tone={uptimeBand(data.slaPct)}
            />
            <StatTile icon={TrendingDown} label="Total downtime" value={formatDuration(data.downtimeSec)} />
            <StatTile icon={AlertCircle} label="Total incidents" value={data.totalIncidents} />
            <StatTile icon={Timer} label="Avg recovery" value={formatDuration(data.avgRecoverySec)} />
          </div>

          {data.monitors.length === 0 ? (
            <Card className="p-10 text-center text-sm text-muted">
              No monitor data recorded for this period yet.
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line-soft p-4">
                <Download className="size-4 text-muted" />
                <span className="text-sm font-medium text-text">Per-monitor SLA — last {data.rangeDays} days</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                      <th className="px-4 py-3 font-medium">Monitor</th>
                      <th className="px-4 py-3 font-medium">Uptime</th>
                      <th className="px-4 py-3 font-medium">Downtime</th>
                      <th className="px-4 py-3 font-medium">Incidents</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-soft">
                    {data.monitors.map((m) => (
                      <tr key={m.monitorId} className="hover:bg-panel-2/50">
                        <td className="px-4 py-3 font-medium text-text">{m.name}</td>
                        <td className="px-4 py-3">
                          <Badge tone={uptimeBand(m.uptimePct)}>{formatPct(m.uptimePct)}</Badge>
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDuration(m.downtimeSec)}</td>
                        <td className="px-4 py-3 text-muted">{m.incidents}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
