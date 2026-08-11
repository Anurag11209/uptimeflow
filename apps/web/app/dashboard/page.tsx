"use client";

import Link from "next/link";
import { AlertTriangle, Mail, ScrollText, Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { HealthBadge } from "@/components/monitors/health-badge";
import { HeartbeatStrip } from "@/components/monitors/heartbeat-strip";
import { hasPermission } from "@backend-uptime/shared";
import { useActiveOrg, useAuditLogs, useOverview } from "@/lib/queries";
import { monitorTarget, useMonitors } from "@/lib/monitors";
import { cn } from "@/lib/utils";

const ACTION_LABELS: Record<string, string> = {
  "user.signed_up": "signed up",
  "user.signed_in": "signed in",
  "user.password_reset": "reset password",
  "member.invited": "invited a member",
  "organization.created": "created the organization",
};

function MiniStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md border border-line-soft bg-panel-2/50 px-3.5 py-2.5">
      <Icon className="size-3.5 shrink-0 text-muted" />
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-display)] text-sm font-semibold leading-none tabular-nums">
          {value}
        </p>
        <p className="mt-1 truncate text-[11px] uppercase tracking-wider text-muted">{label}</p>
      </div>
    </div>
  );
}

/** Aggregate uptime across all monitors' recent-check strips (client-side, cheap). */
function aggregateUptimePct(monitors: { recentChecks: { status: string }[] }[]): number | null {
  const all = monitors.flatMap((m) => m.recentChecks);
  if (all.length === 0) return null;
  const up = all.filter((c) => c.status === "UP").length;
  return (up / all.length) * 100;
}

export default function DashboardOverviewPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const { data: overview, isPending: overviewPending } = useOverview(orgId);
  const canReadMonitors = role ? hasPermission(role, "monitor", ["read"]) : false;
  const { data: monitorPage, isPending: monitorsPending } = useMonitors(orgId, canReadMonitors);

  const canReadAudit = role ? hasPermission(role, "auditLog", ["read"]) : false;
  const { data: auditLogs } = useAuditLogs(orgId, 6, canReadAudit);

  if (orgPending || overviewPending) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-panel" />
        <div className="h-32 animate-pulse rounded-lg bg-panel" />
        <div className="h-64 animate-pulse rounded-lg bg-panel" />
      </div>
    );
  }

  const stats = overview?.stats;
  const monitors = monitorPage?.items ?? [];
  const uptimePct = aggregateUptimePct(monitors);
  const downCount = monitors.filter((m) => m.health === "DOWN").length;
  const degradedCount = monitors.filter((m) => m.health === "DEGRADED").length;
  const allHealthy = downCount === 0 && degradedCount === 0;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          {overview?.organization.name ?? "Overview"}
        </h1>
        <p className="mt-1 text-sm text-muted">Operational snapshot for your organization.</p>
      </div>

      {/* Hero: the thing you actually opened this page to check. */}
      <section
        className={cn(
          "flex flex-col gap-4 rounded-lg border p-6 sm:flex-row sm:items-center sm:justify-between",
          allHealthy ? "border-up/30 bg-up/5" : "border-warn/30 bg-warn/5",
        )}
      >
        <div className="flex items-center gap-4">
          <span
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full border",
              allHealthy ? "border-up/40 bg-up/10" : "border-warn/40 bg-warn/10",
            )}
          >
            <span
              className={cn(
                "size-2.5 rounded-full",
                allHealthy ? "bg-up status-dot" : "bg-warn status-dot",
              )}
            />
          </span>
          <div>
            <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
              {monitorsPending
                ? "Checking monitors…"
                : allHealthy
                  ? "All monitors operational"
                  : `${downCount + degradedCount} monitor${downCount + degradedCount === 1 ? "" : "s"} need attention`}
            </p>
            <p className="text-sm text-muted">
              {stats?.monitors ?? 0} monitor{(stats?.monitors ?? 0) === 1 ? "" : "s"} ·{" "}
              {stats?.openIncidents ?? 0} open incident
              {(stats?.openIncidents ?? 0) === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        {uptimePct !== null ? (
          <div className="text-left sm:text-right">
            <p className="font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums text-text">
              {uptimePct.toFixed(2)}%
            </p>
            <p className="text-xs text-muted">uptime across recent checks</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-line-soft p-5">
            <h2 className="font-[family-name:var(--font-display)] font-semibold">Monitors</h2>
            <Link href="/dashboard/monitors" className="text-xs text-muted hover:text-brand">
              View all →
            </Link>
          </div>
          {monitorsPending ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-panel-2" />
              ))}
            </div>
          ) : monitors.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-5 py-12 text-center">
              <p className="max-w-xs text-xs leading-relaxed text-muted">
                No monitors yet. Create one to start tracking uptime, latency, and incidents across
                your endpoints.
              </p>
              <Link
                href="/dashboard/monitors/new"
                className="text-sm font-medium text-brand hover:underline"
              >
                New monitor
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line-soft">
              {monitors.slice(0, 6).map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/dashboard/monitors/${m.id}`}
                    className="flex items-center gap-4 px-5 py-3 hover:bg-panel-2/50"
                  >
                    <HealthBadge health={m.health} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
                      {m.name}
                      <span className="ml-2 truncate font-[family-name:var(--font-mono)] text-xs font-normal text-muted">
                        {monitorTarget(m)}
                      </span>
                    </span>
                    <HeartbeatStrip
                      checks={m.recentChecks}
                      size={16}
                      className="hidden w-24 sm:flex"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line-soft p-5">
            <h2 className="font-[family-name:var(--font-display)] font-semibold">
              Recent activity
            </h2>
          </div>
          {!canReadAudit ? (
            <p className="px-5 py-10 text-center text-xs text-muted">
              Your role doesn&apos;t have access to the audit log.
            </p>
          ) : auditLogs && auditLogs.items.length > 0 ? (
            <ul className="divide-y divide-line-soft">
              {auditLogs.items.map((log) => (
                <li
                  key={log.id}
                  className="flex items-center justify-between gap-3 px-5 py-3 font-[family-name:var(--font-mono)] text-xs"
                >
                  <span className="truncate text-muted">
                    {ACTION_LABELS[log.action] ?? log.action}
                  </span>
                  <time className="shrink-0 text-muted/60">
                    {new Date(log.createdAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-xs text-muted">No recorded activity yet.</p>
          )}
        </Card>
      </section>

      {/* Org-admin stats: useful, but secondary to operational health. */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat icon={Users} label="Members" value={stats?.members ?? 0} />
        <MiniStat icon={Mail} label="Pending invites" value={stats?.pendingInvitations ?? 0} />
        <MiniStat
          icon={ScrollText}
          label="Audit events (30d)"
          value={stats?.auditEventsLast30d ?? 0}
        />
        <MiniStat icon={AlertTriangle} label="Open incidents" value={stats?.openIncidents ?? 0} />
      </section>
    </div>
  );
}
