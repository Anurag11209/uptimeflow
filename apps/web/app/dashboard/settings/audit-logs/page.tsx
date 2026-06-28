"use client";

import { useMemo, useState } from "react";
import { Download, ScrollText, Search } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { formatDateTime } from "@/lib/format";
import { downloadCsv } from "@/lib/export";
import {
  actionLabel,
  actorTypeLabel,
  auditCsvRows,
  auditResult,
  AUDIT_CSV_COLUMNS,
  useAuditLogList,
  type AuditLogFilters,
  type AuditLogRow,
} from "@/lib/audit-logs";
import { hasPermission } from "@backend-uptime/shared";

export default function AuditLogsPage() {
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canRead = role ? hasPermission(role, "auditLog", ["read"]) : false;

  const [resourceType, setResourceType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const filters: AuditLogFilters = useMemo(
    () => ({
      resourceType: resourceType || undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
    }),
    [resourceType, from, to],
  );

  const list = useAuditLogList(orgId, filters, canRead);
  const rows = useMemo(
    () => (list.data?.pages ?? []).flatMap((p) => p.items),
    [list.data],
  );

  // Resource types for the filter dropdown, harvested from the loaded rows.
  const resourceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.resourceType);
    return [...set].sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.action.toLowerCase().includes(q) ||
        r.resourceType.toLowerCase().includes(q) ||
        (r.actorId?.toLowerCase().includes(q) ?? false) ||
        (r.ipAddress?.toLowerCase().includes(q) ?? false),
    );
  }, [rows, search]);

  function onExport() {
    downloadCsv(`audit-log-${new Date().toISOString().slice(0, 10)}.csv`, auditCsvRows(filtered), AUDIT_CSV_COLUMNS);
  }

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view audit logs.</Alert>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">A record of every important action taken in your organization.</p>
        <Button variant="secondary" size="sm" onClick={onExport} disabled={filtered.length === 0}>
          <Download className="size-3.5" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, resource, actor, IP…"
            className="pl-9"
            aria-label="Search audit logs"
          />
        </div>
        <div className="w-44">
          <Select value={resourceType} onChange={(e) => setResourceType(e.target.value)} aria-label="Resource type">
            <option value="">All resources</option>
            {resourceTypes.map((rt) => (
              <option key={rt} value={rt}>{rt}</option>
            ))}
          </Select>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="text-xs text-muted">From</label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="text-xs text-muted">To</label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </div>
      </div>

      {list.error ? (
        <Alert tone="error">
          {list.error instanceof ApiError ? list.error.message : "Could not load audit logs."}
        </Alert>
      ) : list.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <ScrollText className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">No audit events for this range</p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No events match your search.</Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                    <th className="px-4 py-3 font-medium">Timestamp</th>
                    <th className="px-4 py-3 font-medium">Actor</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">Resource</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {filtered.map((row) => (
                    <AuditRow key={row.id} row={row} />
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

function AuditRow({ row }: { row: AuditLogRow }) {
  const result = auditResult(row.action);
  return (
    <tr className="hover:bg-panel-2/50">
      <td className="whitespace-nowrap px-4 py-3 text-muted">{formatDateTime(row.createdAt)}</td>
      <td className="px-4 py-3">
        <span className="font-[family-name:var(--font-mono)] text-xs text-text">
          {row.actorId ? `${row.actorId.slice(0, 12)}…` : "—"}
        </span>
        <p className="text-xs text-muted">{actorTypeLabel(row.actorType)}</p>
      </td>
      <td className="px-4 py-3 text-text">{actionLabel(row.action)}</td>
      <td className="px-4 py-3 text-muted">
        {row.resourceType}
        {row.resourceId ? (
          <span className="font-[family-name:var(--font-mono)] text-xs"> · {row.resourceId.slice(0, 8)}…</span>
        ) : null}
      </td>
      <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-muted">{row.ipAddress ?? "—"}</td>
      <td className="px-4 py-3">
        <Badge tone={result.ok ? "up" : "down"}>{result.label}</Badge>
      </td>
    </tr>
  );
}
