"use client";

import { useMemo } from "react";
import { Activity, AlertTriangle, Clock, ServerCrash } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/incidents/stat-tile";
import { useIncidentSummary } from "@/lib/incidents";
import { formatDuration } from "@/lib/incidents";
import { useMonitors } from "@/lib/monitors";
import {
  countCritical,
  countToday,
  countUnresolved,
  meanTimeToRecovery,
} from "@/lib/incident-stats";

/** KPI strip for the incident dashboard. Polls active incidents live. */
export function IncidentStatsBar({ orgId }: { orgId: string | undefined }) {
  const summary = useIncidentSummary(orgId, "ALL", true, true);
  const monitors = useMonitors(orgId);

  const incidents = useMemo(() => summary.data?.items ?? [], [summary.data]);
  const downMonitors = useMemo(
    () => (monitors.data?.items ?? []).filter((m) => m.health === "DOWN").length,
    [monitors.data],
  );

  if (summary.isPending) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  const active = countUnresolved(incidents);
  const today = countToday(incidents);
  const mttr = meanTimeToRecovery(incidents);
  const critical = countCritical(incidents);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        icon={Activity}
        label="Active incidents"
        value={active}
        tone={active > 0 ? "down" : "up"}
        hint={active > 0 ? "Needs attention" : "All clear"}
      />
      <StatTile
        icon={AlertTriangle}
        label="Critical / major"
        value={critical}
        tone={critical > 0 ? "down" : "muted"}
        hint="Unresolved, high severity"
      />
      <StatTile
        icon={Clock}
        label="MTTR"
        value={formatDuration(mttr)}
        hint="Mean time to recovery"
      />
      <StatTile
        icon={ServerCrash}
        label="Monitors down"
        value={downMonitors}
        tone={downMonitors > 0 ? "down" : "up"}
        hint="Currently failing"
      />
      <StatTile icon={Activity} label="Incidents today" value={today} hint="Since midnight" />
    </div>
  );
}
