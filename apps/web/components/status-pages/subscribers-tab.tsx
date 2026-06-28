"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api";
import {
  formatDateTime,
  subscriberStatusMeta,
  useStatusPageSubscribers,
} from "@/lib/status-pages";

export function SubscribersTab({ orgId, pageId }: { orgId: string; pageId: string }) {
  const { data, isPending, error } = useStatusPageSubscribers(orgId, pageId);
  const [search, setSearch] = useState("");

  const subscribers = useMemo(() => {
    const items = data?.items ?? [];
    const q = search.trim().toLowerCase();
    return q ? items.filter((s) => s.email.toLowerCase().includes(q)) : items;
  }, [data, search]);

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load subscribers."}
      </Alert>
    );
  }

  const counts = data?.counts ?? { total: 0, active: 0, pending: 0, unsubscribed: 0 };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Active" value={counts.active} tone="up" />
        <Stat label="Pending" value={counts.pending} tone="brand" />
        <Stat label="Unsubscribed" value={counts.unsubscribed} tone="muted" />
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email…"
          className="pl-9"
          aria-label="Search subscribers"
        />
      </div>

      {counts.total === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <Users className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">No subscribers yet</p>
          <p className="max-w-xs text-xs text-muted">
            Visitors can subscribe from the public page to get notified about incidents and
            maintenance.
          </p>
        </Card>
      ) : subscribers.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted">No subscribers match your search.</Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-xs uppercase tracking-wider text-muted">
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Subscribed</th>
                  <th className="px-4 py-3 font-medium">Verified</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {subscribers.map((s) => {
                  const meta = subscriberStatusMeta(s.status);
                  return (
                    <tr key={s.id} className="hover:bg-panel-2/50">
                      <td className="px-4 py-3 font-[family-name:var(--font-mono)] text-xs text-text">
                        {s.email}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDateTime(s.createdAt)}</td>
                      <td className="px-4 py-3 text-muted">{formatDateTime(s.verifiedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "up" | "brand" | "muted";
}) {
  const color =
    tone === "up" ? "text-up" : tone === "brand" ? "text-brand" : tone === "muted" ? "text-muted" : "text-text";
  return (
    <Card className="p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={`mt-1 font-[family-name:var(--font-display)] text-2xl font-semibold ${color}`}>
        {value}
      </p>
    </Card>
  );
}
