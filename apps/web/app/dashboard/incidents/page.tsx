"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Inbox, Search, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { IncidentStatusBadge } from "@/components/incidents/incident-status-badge";
import { SeverityBadge } from "@/components/incidents/severity-badge";
import { IncidentStatsBar } from "@/components/incidents/incident-stats-bar";
import { cn } from "@/lib/utils";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { formatRelativeTime, type IncidentListItem } from "@/lib/monitors";
import {
  formatDuration,
  liveDurationSec,
  useIncidentList,
  type IncidentSeverity,
  type IncidentTab,
} from "@/lib/incidents";
import { hasPermission } from "@backend-uptime/shared";

const TABS: { value: IncidentTab; label: string }[] = [
  { value: "OPEN", label: "Active" },
  { value: "ACKNOWLEDGED", label: "Acknowledged" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "ALL", label: "All" },
];

const SEVERITIES: IncidentSeverity[] = ["CRITICAL", "MAJOR", "MINOR", "WARNING"];

export default function IncidentsPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "monitor", ["read"]) : false;

  const [tab, setTab] = useState<IncidentTab>("OPEN");
  const [search, setSearch] = useState("");
  const [severity, setSeverity] = useState<IncidentSeverity | "ALL">("ALL");

  const list = useIncidentList(orgId, tab, canRead);

  const rows = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p.items),
    [list.data],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((inc) => {
      if (severity !== "ALL" && inc.severity !== severity) return false;
      if (!q) return true;
      return (
        inc.title.toLowerCase().includes(q) ||
        (inc.monitorName?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rows, search, severity]);

  if (orgPending) return <IncidentsSkeleton />;
  if (!canRead) {
    return (
      <Alert tone="warning">You do not have permission to view incidents.</Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          Incidents
        </h1>
        <p className="mt-1 text-sm text-muted">
          Detect, triage, and resolve outages across your monitors.
        </p>
      </header>

      <IncidentStatsBar orgId={orgId} />

      {/* Tabs */}
      <div
        className="flex gap-1 border-b border-line-soft"
        role="tablist"
        aria-label="Incident status"
      >
        {TABS.map((t) => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.value)}
              className={cn(
                "-mb-px border-b-2 px-3 py-2 text-sm transition-colors",
                active
                  ? "border-brand text-text"
                  : "border-transparent text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by title or monitor…"
            className="pl-9"
            aria-label="Search incidents"
          />
        </div>
        <div className="w-44">
          <Select
            value={severity}
            onChange={(e) =>
              setSeverity(e.target.value as IncidentSeverity | "ALL")
            }
            aria-label="Filter by severity"
          >
            <option value="ALL">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.error ? (
        <Alert tone="error">
          {list.error instanceof ApiError
            ? list.error.message
            : "Could not load incidents."}
        </Alert>
      ) : list.isPending ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <EmptyState tab={tab} filtered={rows.length > 0} />
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Severity</th>
                    <th className="px-4 py-3 font-medium">Incident</th>
                    <th className="px-4 py-3 font-medium">Monitor</th>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {filtered.map((inc) => (
                    <IncidentRow key={inc.id} inc={inc} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {list.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                size="sm"
                loading={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function IncidentRow({ inc }: { inc: IncidentListItem }) {
  const duration = formatDuration(liveDurationSec(inc));
  return (
    <tr className="hover:bg-panel-2/50">
      <td className="px-4 py-3">
        <IncidentStatusBadge status={inc.status} />
      </td>
      <td className="px-4 py-3">
        <SeverityBadge severity={inc.severity} />
      </td>
      <td className="px-4 py-3">
        <Link
          href={`/dashboard/incidents/${inc.id}`}
          className="font-medium text-text hover:text-brand"
        >
          {inc.title}
        </Link>
      </td>
      <td className="px-4 py-3 text-muted">{inc.monitorName ?? "—"}</td>
      <td className="px-4 py-3 text-muted">{formatRelativeTime(inc.startedAt)}</td>
      <td className="px-4 py-3 tabular-nums text-muted">{duration}</td>
    </tr>
  );
}

function EmptyState({ tab, filtered }: { tab: IncidentTab; filtered: boolean }) {
  if (filtered) {
    return (
      <Card className="p-10 text-center text-sm text-muted">
        No incidents match your filters.
      </Card>
    );
  }
  const allClear = tab === "OPEN" || tab === "ACKNOWLEDGED";
  return (
    <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full border border-line bg-panel-2">
        {allClear ? (
          <ShieldCheck className="size-5 text-up" />
        ) : (
          <Inbox className="size-5 text-muted" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-text">
          {allClear ? "No active incidents" : "Nothing here yet"}
        </p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
          {allClear
            ? "Every monitored service is healthy. Incidents will appear here the moment something goes down."
            : "Resolved incidents will show up here once they happen."}
        </p>
      </div>
    </Card>
  );
}

function TableSkeleton() {
  return (
    <Card className="divide-y divide-line-soft">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-16" />
          <Skeleton className="h-5 flex-1" />
          <Skeleton className="h-5 w-24" />
        </div>
      ))}
    </Card>
  );
}

function IncidentsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <TableSkeleton />
    </div>
  );
}
