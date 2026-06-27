"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  Eye,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { HealthBadge } from "@/components/monitors/health-badge";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import {
  formatInterval,
  formatRelativeTime,
  formatResponseMs,
  monitorTarget,
  monitorTypeLabel,
  useDeleteMonitor,
  useMonitors,
  useToggleMonitorState,
  type MonitorHealth,
  type MonitorListItem,
  type MonitorType,
} from "@/lib/monitors";
import { SUPPORTED_MONITOR_TYPES } from "@/lib/monitors";
import { hasPermission } from "@backend-uptime/shared";

const PAGE_SIZE = 12;

const HEALTH_FILTERS: { value: MonitorHealth | "ALL"; label: string }[] = [
  { value: "ALL", label: "All statuses" },
  { value: "UP", label: "Up" },
  { value: "DOWN", label: "Down" },
  { value: "DEGRADED", label: "Degraded" },
  { value: "PENDING", label: "Pending" },
  { value: "PAUSED", label: "Paused" },
  { value: "MAINTENANCE", label: "Maintenance" },
];

export default function MonitorsPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "monitor", ["read"]) : false;
  const canManage = role
    ? hasPermission(role, "monitor", ["create", "update", "delete"])
    : false;

  const { data, isPending, error } = useMonitors(orgId, canRead);
  const toggleState = useToggleMonitorState(orgId ?? "");
  const deleteMonitor = useDeleteMonitor(orgId ?? "");
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<MonitorHealth | "ALL">("ALL");
  const [typeFilter, setTypeFilter] = useState<MonitorType | "ALL">("ALL");
  const [page, setPage] = useState(0);
  const [toDelete, setToDelete] = useState<MonitorListItem | null>(null);

  const monitors = data?.items ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return monitors.filter((m) => {
      if (healthFilter !== "ALL" && m.health !== healthFilter) return false;
      if (typeFilter !== "ALL" && m.type !== typeFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        monitorTarget(m).toLowerCase().includes(q)
      );
    });
  }, [monitors, search, healthFilter, typeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  function resetPage<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(0);
    };
  }

  async function onToggle(m: MonitorListItem) {
    const action = m.state === "PAUSED" ? "resume" : "pause";
    try {
      await toggleState.mutateAsync({ id: m.id, action });
      toast(
        action === "pause" ? "Monitor paused." : "Monitor resumed.",
        "success",
      );
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not update monitor.",
        "error",
      );
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    try {
      await deleteMonitor.mutateAsync(toDelete.id);
      toast("Monitor deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(
        err instanceof ApiError ? err.message : "Could not delete monitor.",
        "error",
      );
    }
  }

  if (orgPending) return <ListSkeleton />;
  if (!canRead) {
    return (
      <Alert tone="warning">You do not have permission to view monitors.</Alert>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
            Monitors
          </h1>
          <p className="mt-1 text-sm text-muted">
            Uptime checks across your endpoints and services.
          </p>
        </div>
        {canManage ? (
          <ButtonLink href="/dashboard/monitors/new">
            <Plus className="size-4" /> New monitor
          </ButtonLink>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            placeholder="Search by name or target…"
            className="pl-9"
            aria-label="Search monitors"
          />
        </div>
        <div className="w-44">
          <Select
            value={healthFilter}
            onChange={(e) =>
              resetPage(setHealthFilter)(e.target.value as MonitorHealth | "ALL")
            }
            aria-label="Filter by status"
          >
            {HEALTH_FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select
            value={typeFilter}
            onChange={(e) =>
              resetPage(setTypeFilter)(e.target.value as MonitorType | "ALL")
            }
            aria-label="Filter by type"
          >
            <option value="ALL">All types</option>
            {SUPPORTED_MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {monitorTypeLabel(t)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {error ? (
        <Alert tone="error">
          {error instanceof ApiError ? error.message : "Could not load monitors."}
        </Alert>
      ) : isPending ? (
        <ListSkeleton rowsOnly />
      ) : monitors.length === 0 ? (
        <EmptyState canManage={canManage} />
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">
          No monitors match your filters.
        </Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Name</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Interval</th>
                    <th className="px-4 py-3 font-medium">Last check</th>
                    <th className="px-4 py-3 font-medium">Response</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {pageItems.map((m) => (
                    <tr key={m.id} className="hover:bg-panel-2/50">
                      <td className="px-4 py-3">
                        <HealthBadge health={m.health} />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/monitors/${m.id}`}
                          className="font-medium text-text hover:text-brand"
                        >
                          {m.name}
                        </Link>
                        <p className="truncate font-[family-name:var(--font-mono)] text-xs text-muted">
                          {monitorTarget(m)}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="muted">{monitorTypeLabel(m.type)}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {formatInterval(m.intervalSeconds)}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {formatRelativeTime(m.lastCheckedAt)}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {formatResponseMs(m.lastResponseMs)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1.5">
                          <ButtonLink
                            href={`/dashboard/monitors/${m.id}`}
                            variant="ghost"
                            size="sm"
                            aria-label={`View ${m.name}`}
                          >
                            <Eye className="size-3.5" />
                          </ButtonLink>
                          {canManage ? (
                            <>
                              <ButtonLink
                                href={`/dashboard/monitors/${m.id}/edit`}
                                variant="ghost"
                                size="sm"
                                aria-label={`Edit ${m.name}`}
                              >
                                <Pencil className="size-3.5" />
                              </ButtonLink>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onToggle(m)}
                                aria-label={
                                  m.state === "PAUSED"
                                    ? `Resume ${m.name}`
                                    : `Pause ${m.name}`
                                }
                              >
                                {m.state === "PAUSED" ? (
                                  <Play className="size-3.5" />
                                ) : (
                                  <Pause className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => setToDelete(m)}
                                aria-label={`Delete ${m.name}`}
                              >
                                <Trash2 className="size-3.5" />
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {pageCount > 1 ? (
            <div className="flex items-center justify-between text-sm text-muted">
              <span>
                {filtered.length} monitor{filtered.length === 1 ? "" : "s"}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </Button>
                <span className="px-1">
                  {safePage + 1} / {pageCount}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete monitor?"
        description={
          toDelete
            ? `"${toDelete.name}" and its check history will be permanently removed.`
            : undefined
        }
        confirmLabel="Delete monitor"
        loading={deleteMonitor.isPending}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function EmptyState({ canManage }: { canManage: boolean }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full border border-line bg-panel-2">
        <Activity className="size-5 text-muted" />
      </div>
      <div>
        <p className="text-sm font-medium text-text">No monitors yet</p>
        <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted">
          Create your first monitor to start tracking uptime, latency, and
          incidents across your endpoints.
        </p>
      </div>
      {canManage ? (
        <ButtonLink href="/dashboard/monitors/new" size="sm">
          <Plus className="size-4" /> New monitor
        </ButtonLink>
      ) : null}
    </Card>
  );
}

function ListSkeleton({ rowsOnly = false }: { rowsOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      {!rowsOnly ? <Skeleton className="h-8 w-48" /> : null}
      <Card className="divide-y divide-line-soft">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-5 w-16" />
          </div>
        ))}
      </Card>
    </div>
  );
}
