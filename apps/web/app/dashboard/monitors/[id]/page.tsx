"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ArrowLeft, Pause, Pencil, Play, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { HealthBadge } from "@/components/monitors/health-badge";
import { LineChart } from "@/components/charts/line-chart";
import { AvailabilityChart } from "@/components/charts/availability-chart";
import { UptimeBars, type UptimeCell } from "@/components/charts/uptime-bars";
import { MonitorAnalytics } from "@/components/analytics/monitor-analytics";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import {
  averageLatency,
  checkStatusMeta,
  formatInterval,
  formatRelativeTime,
  formatResponseMs,
  formatUptimePercent,
  incidentStatusMeta,
  monitorTarget,
  monitorTypeLabel,
  regionLabel,
  toDailyAvailability,
  toLatencyPoints,
  uptimePercent,
  useAlertChannels,
  useCheckResults,
  useDeleteMonitor,
  useMonitor,
  useMonitorIncidents,
  useMonitorMaintenanceWindows,
  useToggleMonitorState,
  type CheckResultItem,
} from "@/lib/monitors";
import { hasPermission } from "@backend-uptime/shared";

export default function MonitorDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "monitor", ["read"]) : false;
  const canManage = role
    ? hasPermission(role, "monitor", ["create", "update", "delete"])
    : false;

  const monitor = useMonitor(orgId, canRead ? id : undefined);
  const checks = useCheckResults(orgId, canRead ? id : undefined, 100);
  const windows = useMonitorMaintenanceWindows(orgId, canRead ? id : undefined);
  const incidents = useMonitorIncidents(orgId, canRead ? id : undefined);
  const channels = useAlertChannels(orgId, canRead);

  const toggleState = useToggleMonitorState(orgId ?? "");
  const deleteMonitor = useDeleteMonitor(orgId ?? "");
  const { toast } = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (orgPending) return <DetailSkeleton />;
  if (!canRead) {
    return (
      <Alert tone="warning">You do not have permission to view monitors.</Alert>
    );
  }
  if (monitor.isPending) return <DetailSkeleton />;
  if (monitor.error || !monitor.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert tone="error">
          {monitor.error instanceof ApiError
            ? monitor.error.message
            : "Monitor not found."}
        </Alert>
      </div>
    );
  }

  const m = monitor.data;
  const checkItems = checks.data?.items ?? [];
  const latencyPoints = toLatencyPoints(checkItems);
  const dailyAvailability = toDailyAvailability(checkItems);
  const uptime = uptimePercent(checkItems);
  const avgLatency = averageLatency(checkItems);
  const channelMap = new Map(
    (channels.data?.items ?? []).map((c) => [c.id, c]),
  );

  // Newest-last bars for the availability strip.
  const cells: UptimeCell[] = [...checkItems]
    .reverse()
    .slice(-40)
    .map((c) => ({
      status: c.status,
      title: `${checkStatusMeta(c.status).label} · ${new Date(
        c.checkedAt,
      ).toLocaleString()}`,
    }));

  async function onToggle() {
    const action = m.state === "PAUSED" ? "resume" : "pause";
    try {
      await toggleState.mutateAsync({ id: m.id, action });
      toast(action === "pause" ? "Monitor paused." : "Monitor resumed.", "success");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not update monitor.",
        "error",
      );
    }
  }

  async function onDelete() {
    try {
      await deleteMonitor.mutateAsync(m.id);
      toast("Monitor deleted.", "success");
      router.push("/dashboard/monitors");
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not delete monitor.",
        "error",
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
              {m.name}
            </h1>
            <HealthBadge health={m.health} />
          </div>
          <p className="mt-1 truncate font-[family-name:var(--font-mono)] text-sm text-muted">
            {monitorTarget(m)}
          </p>
        </div>
        {canManage ? (
          <div className="flex shrink-0 gap-2">
            <ButtonLink
              href={`/dashboard/monitors/${m.id}/edit`}
              variant="secondary"
              size="sm"
            >
              <Pencil className="size-3.5" /> Edit
            </ButtonLink>
            <Button variant="secondary" size="sm" onClick={onToggle}>
              {m.state === "PAUSED" ? (
                <>
                  <Play className="size-3.5" /> Resume
                </>
              ) : (
                <>
                  <Pause className="size-3.5" /> Pause
                </>
              )}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        ) : null}
      </header>

      {/* Overview */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Uptime (recent)" value={formatUptimePercent(uptime)} />
        <Stat
          label="Avg response"
          value={avgLatency !== null ? formatResponseMs(avgLatency) : "—"}
        />
        <Stat label="Type" value={monitorTypeLabel(m.type)} />
        <Stat label="Interval" value={formatInterval(m.intervalSeconds)} />
        <Stat label="Last check" value={formatRelativeTime(m.lastCheckedAt)} />
        <Stat
          label="Last status code"
          value={m.lastStatusCode !== null ? String(m.lastStatusCode) : "—"}
        />
        <Stat label="SSL verification" value={m.verifySsl ? "On" : "Off"} />
        <Stat
          label="Created"
          value={new Date(m.createdAt).toLocaleDateString()}
        />
      </section>

      {m.lastError ? (
        <Alert tone="error">
          Last error: <span className="font-medium">{m.lastError}</span>
        </Alert>
      ) : null}

      {/* Availability strip */}
      <Card className="p-5">
        <SectionHeading
          title="Recent checks"
          right={
            <span className="text-xs text-muted">
              {checkItems.length} checks · regions{" "}
              {m.regions.length
                ? m.regions.map(regionLabel).join(", ")
                : "default"}
            </span>
          }
        />
        {checks.isPending ? (
          <Skeleton className="h-6 w-full" />
        ) : cells.length === 0 ? (
          <p className="text-sm text-muted">No checks recorded yet.</p>
        ) : (
          <UptimeBars cells={cells} />
        )}
      </Card>

      {/* Charts */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeading title="Response time" />
          <LineChart points={latencyPoints} label="Response time" unit=" ms" />
        </Card>
        <Card className="p-5">
          <SectionHeading title="Daily availability" />
          <AvailabilityChart days={dailyAvailability} />
        </Card>
      </section>

      {/* Long-horizon analytics from the daily rollup (uptime, p95, regional). */}
      {orgId ? (
        <Card className="p-5">
          <MonitorAnalytics orgId={orgId} monitorId={id} />
        </Card>
      ) : null}

      {/* Check history */}
      <Card className="overflow-hidden">
        <div className="p-5">
          <SectionHeading title="Check history" />
        </div>
        {checks.isPending ? (
          <div className="p-5 pt-0">
            <Skeleton className="h-40 w-full" />
          </div>
        ) : checkItems.length === 0 ? (
          <p className="p-5 pt-0 text-sm text-muted">No checks recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Region</th>
                  <th className="px-4 py-2.5 font-medium">Latency</th>
                  <th className="px-4 py-2.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {checkItems.slice(0, 50).map((c: CheckResultItem) => {
                  const meta = checkStatusMeta(c.status);
                  return (
                    <tr key={c.id}>
                      <td className="whitespace-nowrap px-4 py-2.5 text-muted">
                        {new Date(c.checkedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {regionLabel(c.region)}
                      </td>
                      <td className="px-4 py-2.5 text-muted">
                        {formatResponseMs(c.responseMs)}
                      </td>
                      <td className="max-w-xs truncate px-4 py-2.5 text-muted">
                        {c.errorMessage ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Alert channels + maintenance windows */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <SectionHeading title="Alert channels" />
          {m.boundChannelIds.length === 0 ? (
            <p className="text-sm text-muted">No channels bound to this monitor.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {m.boundChannelIds.map((cid) => {
                const ch = channelMap.get(cid);
                return (
                  <li
                    key={cid}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-text">{ch?.name ?? cid}</span>
                    {ch ? <Badge tone="muted">{ch.type}</Badge> : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <SectionHeading title="Maintenance windows" />
          {windows.isPending ? (
            <Skeleton className="h-16 w-full" />
          ) : (windows.data?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted">No maintenance windows scheduled.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line-soft">
              {windows.data!.map((w) => (
                <li key={w.id} className="flex flex-col gap-0.5 py-2.5">
                  <span className="text-sm font-medium text-text">{w.title}</span>
                  <span className="text-xs text-muted">
                    {new Date(w.startsAt).toLocaleString()} →{" "}
                    {new Date(w.endsAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* Recent incidents */}
      <Card className="p-5">
        <SectionHeading title="Recent incidents" />
        {incidents.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : (incidents.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-muted">No incidents for this monitor. 🎉</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {incidents.data!.items.map((inc) => {
              const meta = incidentStatusMeta(inc.status);
              return (
                <li
                  key={inc.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-text">{inc.title}</p>
                    <p className="text-xs text-muted">
                      Started {formatRelativeTime(inc.startedAt)}
                    </p>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete monitor?"
        description={`"${m.name}" and its check history will be permanently removed.`}
        confirmLabel="Delete monitor"
        loading={deleteMonitor.isPending}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/monitors"
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
    >
      <ArrowLeft className="size-4" /> Back to monitors
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold text-text">
        {value}
      </p>
    </Card>
  );
}

function SectionHeading({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-text">
        {title}
      </h2>
      {right}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-64" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
