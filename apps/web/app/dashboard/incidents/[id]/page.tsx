"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useMemo, type ReactNode } from "react";
import { ArrowLeft, Bell, ExternalLink } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { IncidentStatusBadge } from "@/components/incidents/incident-status-badge";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { IncidentTimeline } from "@/components/incidents/incident-timeline";
import { IncidentActions } from "@/components/incidents/incident-actions";
import { CommentForm } from "@/components/incidents/comment-form";
import { ApiError } from "@/lib/api";
import { useActiveOrg, useMembers } from "@/lib/queries";
import {
  formatRelativeTime,
  monitorTarget,
  monitorTypeLabel,
  regionLabel,
  toLatencyPoints,
  useCheckResults,
  useMonitor,
  useMonitorMaintenanceWindows,
} from "@/lib/monitors";
import {
  formatDuration,
  liveDurationSec,
  useIncident,
  type IncidentTimelineEvent,
} from "@/lib/incidents";
import { hasPermission } from "@backend-uptime/shared";

// Code-split the SVG chart into its own chunk — it's only needed on this page.
const LineChart = dynamic(
  () => import("@/components/charts/line-chart").then((m) => m.LineChart),
  { loading: () => <Skeleton className="h-40 w-full" /> },
);

export default function IncidentDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "monitor", ["read"]) : false;
  const canManage = role
    ? hasPermission(role, "monitor", ["create", "update", "delete"])
    : false;

  const incident = useIncident(orgId, canRead ? id : undefined);
  const monitorId = incident.data?.monitorId ?? undefined;

  const monitor = useMonitor(orgId, monitorId);
  const checks = useCheckResults(orgId, monitorId, 60);
  const windows = useMonitorMaintenanceWindows(orgId, monitorId);
  const members = useMembers(orgId, canRead);

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members.data?.items ?? []) map.set(m.user.id, m.user.name);
    return map;
  }, [members.data]);

  const events = incident.data?.events ?? [];
  const alertEvents = useMemo(
    () => events.filter((e) => e.type === "NOTIFICATION_SENT"),
    [events],
  );
  const comments = useMemo(
    () => events.filter((e) => e.type === "COMMENT"),
    [events],
  );
  const latencyPoints = useMemo(
    () => toLatencyPoints(checks.data?.items ?? []),
    [checks.data],
  );

  if (orgPending) return <DetailSkeleton />;
  if (!canRead) {
    return (
      <Alert tone="warning">You do not have permission to view incidents.</Alert>
    );
  }
  if (incident.isPending) return <DetailSkeleton />;
  if (incident.error || !incident.data) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <Alert tone="error">
          {incident.error instanceof ApiError
            ? incident.error.message
            : "Incident not found."}
        </Alert>
      </div>
    );
  }

  const inc = incident.data;
  const regions = monitor.data?.regions ?? [];

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <IncidentStatusBadge status={inc.status} />
            <SeverityBadge severity={inc.severity} />
            {inc.status !== "RESOLVED" ? (
              <span className="text-xs text-muted">· live</span>
            ) : null}
          </div>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-xl font-semibold text-text">
            {inc.title}
          </h1>
          {inc.summary ? (
            <p className="mt-1 text-sm text-muted">{inc.summary}</p>
          ) : null}
        </div>
        <IncidentActions orgId={orgId!} incident={inc} canManage={canManage} />
      </header>

      {/* Overview */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Meta label="Started" value={new Date(inc.startedAt).toLocaleString()} />
        <Meta
          label="Resolved"
          value={inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleString() : "—"}
        />
        <Meta label="Duration" value={formatDuration(liveDurationSec(inc))} />
        <Meta
          label="Acknowledged"
          value={
            inc.acknowledgedById
              ? (actors.get(inc.acknowledgedById) ?? "Yes")
              : "—"
          }
        />
        <Meta
          label="Impacted regions"
          value={regions.length ? regions.map(regionLabel).join(", ") : "Default"}
        />
        <Meta label="Trigger" value={inc.monitorId ? "Monitor check failure" : "Manual"} />
      </section>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Left column */}
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <Heading>Timeline</Heading>
            <IncidentTimeline events={events} actors={actors} />
          </Card>

          <Card className="p-5">
            <Heading>Comments</Heading>
            {comments.length === 0 ? (
              <p className="mb-4 text-sm text-muted">No comments yet.</p>
            ) : (
              <ul className="mb-4 flex flex-col gap-3">
                {comments.map((c) => (
                  <CommentItem key={c.id} event={c} author={c.actorId ? actors.get(c.actorId) : null} />
                ))}
              </ul>
            )}
            {canManage ? <CommentForm orgId={orgId!} incidentId={inc.id} /> : null}
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-6">
          <Card className="p-5">
            <Heading>Affected monitor</Heading>
            {monitor.isPending && monitorId ? (
              <Skeleton className="h-16 w-full" />
            ) : monitor.data ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Link
                    href={`/dashboard/monitors/${monitor.data.id}`}
                    className="font-medium text-text hover:text-brand"
                  >
                    {monitor.data.name}
                  </Link>
                  <Badge tone="muted">{monitorTypeLabel(monitor.data.type)}</Badge>
                </div>
                <p className="truncate font-[family-name:var(--font-mono)] text-xs text-muted">
                  {monitorTarget(monitor.data)}
                </p>
                <Link
                  href={`/dashboard/monitors/${monitor.data.id}`}
                  className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                >
                  <ExternalLink className="size-3" /> View monitor
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted">No monitor linked to this incident.</p>
            )}
          </Card>

          {monitorId ? (
            <Card className="p-5">
              <Heading>Response time</Heading>
              {checks.isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : (
                <LineChart points={latencyPoints} label="Response time" unit=" ms" />
              )}
            </Card>
          ) : null}

          <Card className="p-5">
            <Heading>Root cause</Heading>
            <p className="text-sm text-muted">
              {inc.cause ?? "No root cause recorded."}
            </p>
          </Card>

          <Card className="p-5">
            <Heading>Alert history</Heading>
            {alertEvents.length === 0 ? (
              <p className="text-sm text-muted">No alerts sent.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {alertEvents.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <Bell className="size-3.5 text-muted" aria-hidden />
                    <span className="flex-1 text-text">{e.message ?? "Alert sent"}</span>
                    <span className="text-xs text-muted">
                      {formatRelativeTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <Heading>Related maintenance</Heading>
            {windows.isPending && monitorId ? (
              <Skeleton className="h-12 w-full" />
            ) : (windows.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">No maintenance windows.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {windows.data!.map((w) => (
                  <li key={w.id} className="flex flex-col gap-0.5 py-2">
                    <span className="text-sm text-text">{w.title}</span>
                    <span className="text-xs text-muted">
                      {new Date(w.startsAt).toLocaleString()} →{" "}
                      {new Date(w.endsAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function CommentItem({
  event,
  author,
}: {
  event: IncidentTimelineEvent;
  author: string | null | undefined;
}) {
  return (
    <li className="rounded-md border border-line-soft bg-panel-2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text">{author ?? "Someone"}</span>
        <span className="text-xs text-muted">{formatRelativeTime(event.createdAt)}</span>
      </div>
      <p className="mt-1 break-words text-sm text-muted">{event.message}</p>
    </li>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/incidents"
      className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
    >
      <ArrowLeft className="size-4" /> Back to incidents
    </Link>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 font-[family-name:var(--font-display)] text-sm font-semibold text-text">
      {children}
    </h2>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-text" title={value}>
        {value}
      </p>
    </Card>
  );
}

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-80 w-full" />
      </div>
    </div>
  );
}
