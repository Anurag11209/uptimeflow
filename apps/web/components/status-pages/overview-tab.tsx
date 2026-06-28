"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  componentStatusMeta,
  overallStatus,
  useStatusPageComponents,
  useStatusPageIncidents,
  useStatusPageSubscribers,
  visibilityMeta,
  type StatusPageSummary,
} from "@/lib/status-pages";
import { overallHeadline } from "@/lib/status";

const PUBLIC_BASE = process.env.NEXT_PUBLIC_APP_URL ?? "";

export function OverviewTab({
  orgId,
  page,
}: {
  orgId: string;
  page: StatusPageSummary;
}) {
  const components = useStatusPageComponents(orgId, page.id);
  const incidents = useStatusPageIncidents(orgId, page.id);
  const subscribers = useStatusPageSubscribers(orgId, page.id);

  const comps = components.data?.items ?? [];
  const overall = overallStatus(comps);
  const meta = componentStatusMeta(overall);
  const vis = visibilityMeta(page.visibility);

  const activeIncidents = (incidents.data?.items ?? []).filter(
    (i) => !i.resolvedAt && i.impact !== "MAINTENANCE",
  ).length;
  const activeMaintenance = (incidents.data?.items ?? []).filter(
    (i) => !i.resolvedAt && i.impact === "MAINTENANCE",
  ).length;
  const subscriberCount = subscribers.data?.counts.active ?? 0;

  const publicUrl = page.customDomain
    ? `https://${page.customDomain}`
    : `${PUBLIC_BASE}/status/${page.slug}`;

  return (
    <div className="flex flex-col gap-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={`size-3 rounded-full ${meta.dot}`} />
            <div>
              <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
                {components.isPending ? "…" : overallHeadline(overall)}
              </p>
              <p className="text-xs text-muted">Current overall status</p>
            </div>
          </div>
          <Badge tone={vis.tone}>{vis.label}</Badge>
        </div>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Components" value={components.isPending ? null : comps.length} />
        <Stat
          label="Active incidents"
          value={incidents.isPending ? null : activeIncidents}
          tone={activeIncidents > 0 ? "down" : "default"}
        />
        <Stat
          label="Active maintenance"
          value={incidents.isPending ? null : activeMaintenance}
          tone={activeMaintenance > 0 ? "brand" : "default"}
        />
        <Stat label="Active subscribers" value={subscribers.isPending ? null : subscriberCount} />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-5">
        <div>
          <p className="text-sm font-medium text-text">Public page</p>
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            className="font-[family-name:var(--font-mono)] text-xs text-brand hover:underline"
          >
            {page.customDomain ?? `/status/${page.slug}`}
          </a>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-3 text-xs text-text transition-colors hover:border-brand/60 hover:text-brand"
        >
          Preview <ExternalLink className="size-3.5" />
        </a>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | null;
  tone?: "default" | "down" | "brand";
}) {
  const color = tone === "down" ? "text-down" : tone === "brand" ? "text-brand" : "text-text";
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      {value === null ? (
        <Skeleton className="mt-2 h-8 w-12" />
      ) : (
        <p className={`mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold ${color}`}>
          {value}
        </p>
      )}
    </Card>
  );
}
