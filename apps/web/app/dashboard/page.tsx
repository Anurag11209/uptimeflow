"use client";

import Link from "next/link";
import { Activity, AlertTriangle, Mail, ScrollText, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { hasPermission } from "@backend-uptime/shared";
import { useActiveOrg, useAuditLogs, useOverview } from "@/lib/queries";

const ACTION_LABELS: Record<string, string> = {
  "user.signed_up": "signed up",
  "user.signed_in": "signed in",
  "user.password_reset": "reset password",
  "member.invited": "invited a member",
  "organization.created": "created the organization",
};

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">
          {label}
        </span>
        <Icon className="size-4 text-muted" />
      </div>
      <p className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tabular-nums">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

export default function DashboardOverviewPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const { data: overview, isPending: overviewPending } = useOverview(orgId);

  const canReadAudit = role
    ? hasPermission(role, "auditLog", ["read"])
    : false;
  const { data: auditLogs } = useAuditLogs(orgId, 8, canReadAudit);

  if (orgPending || overviewPending) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-panel" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-panel" />
          ))}
        </div>
      </div>
    );
  }

  const stats = overview?.stats;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
          {overview?.organization.name ?? "Overview"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Operational snapshot for your organization.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={Users}
          label="Members"
          value={stats?.members ?? 0}
          hint="Active in this org"
        />
        <StatCard
          icon={Mail}
          label="Pending invites"
          value={stats?.pendingInvitations ?? 0}
          hint="Awaiting acceptance"
        />
        <StatCard
          icon={ScrollText}
          label="Audit events"
          value={stats?.auditEventsLast30d ?? 0}
          hint="Last 30 days"
        />
        <StatCard
          icon={AlertTriangle}
          label="Open incidents"
          value={stats?.openIncidents ?? 0}
          hint="Across all monitors"
        />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-line-soft p-5">
            <div className="flex items-center gap-2">
              <Activity className="size-4 text-muted" />
              <h2 className="font-[family-name:var(--font-display)] font-semibold">
                Monitors
              </h2>
            </div>
            <Badge tone="brand">Phase 2</Badge>
          </div>
          <div className="flex flex-col items-center justify-center gap-2 px-5 py-14 text-center">
            <p className="text-sm text-text">No monitors yet</p>
            <p className="max-w-xs text-xs leading-relaxed text-muted">
              Multi-region HTTP, TCP, ping, DNS and keyword checks arrive in
              Phase 2 — the monitoring engine. This phase ships the account and
              organization foundation they&apos;ll run on.
            </p>
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between border-b border-line-soft p-5">
            <div className="flex items-center gap-2">
              <ScrollText className="size-4 text-muted" />
              <h2 className="font-[family-name:var(--font-display)] font-semibold">
                Recent activity
              </h2>
            </div>
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
            <p className="px-5 py-10 text-center text-xs text-muted">
              No recorded activity yet.
            </p>
          )}
          {canReadAudit ? (
            <div className="border-t border-line-soft p-3 text-center">
              <Link
                href="/dashboard/settings/members"
                className="text-xs text-muted hover:text-brand"
              >
                Manage members &amp; invitations
              </Link>
            </div>
          ) : null}
        </Card>
      </section>
    </div>
  );
}
