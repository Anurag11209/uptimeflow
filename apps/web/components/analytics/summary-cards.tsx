"use client";

import {
  Activity,
  AlertTriangle,
  Clock,
  Gauge,
  ServerCrash,
  ShieldCheck,
  Timer,
  Zap,
} from "lucide-react";
import { StatTile } from "@/components/incidents/stat-tile";
import { Skeleton } from "@/components/ui/skeleton";
import { formatResponseMs, type Tone } from "@/lib/monitors";
import {
  formatDuration,
  formatPct,
  uptimeBand,
  type AnalyticsSummary,
} from "@/lib/analytics";

export function SummaryCards({
  summary,
  isPending,
}: {
  summary: AnalyticsSummary | undefined;
  isPending: boolean;
}) {
  if (isPending || !summary) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const slaTone: Tone = uptimeBand(summary.slaCompliancePct);
  const uptimeTone: Tone = uptimeBand(summary.overallUptimePct);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        icon={Gauge}
        label="Overall uptime"
        value={formatPct(summary.overallUptimePct)}
        hint={`Last ${summary.rangeDays} days`}
        tone={uptimeTone}
      />
      <StatTile icon={Activity} label="Active monitors" value={`${summary.activeMonitors}/${summary.totalMonitors}`} />
      <StatTile
        icon={AlertTriangle}
        label="Active incidents"
        value={summary.activeIncidents}
        tone={summary.activeIncidents > 0 ? "down" : "up"}
      />
      <StatTile icon={Clock} label="MTTR" value={formatDuration(summary.mttrSec)} hint="Mean time to recovery" />
      <StatTile icon={Timer} label="MTBF" value={formatDuration(summary.mtbfSec)} hint="Mean time between failures" />
      <StatTile icon={Zap} label="Avg response" value={formatResponseMs(summary.avgResponseMs)} />
      <StatTile
        icon={ShieldCheck}
        label="SLA compliance"
        value={formatPct(summary.slaCompliancePct)}
        tone={slaTone}
      />
      <StatTile
        icon={ServerCrash}
        label="Failed checks today"
        value={summary.failedChecksToday}
        tone={summary.failedChecksToday > 0 ? "down" : "up"}
      />
    </div>
  );
}
