"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Monitor } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { authClient, useSession } from "@/lib/auth-client";
import { deviceLabel } from "@/lib/sessions";
import { formatDateTime } from "@/lib/format";

interface SessionRow {
  id: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export function ActiveSessions() {
  const { data: current } = useSession();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const res = await authClient.listSessions();
      if (res.error) throw new Error(res.error.message ?? "Failed to load sessions.");
      return (res.data ?? []) as SessionRow[];
    },
  });

  async function revoke(token: string) {
    setBusy(token);
    const { error } = await authClient.revokeSession({ token });
    setBusy(null);
    if (error) {
      toast(error.message ?? "Could not revoke session.", "error");
      return;
    }
    toast("Session revoked.", "success");
    void sessions.refetch();
  }

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-line-soft p-5">
        <Monitor className="size-4 text-muted" />
        <h2 className="font-[family-name:var(--font-display)] font-semibold">Active sessions</h2>
      </div>
      <div className="p-5">
        {sessions.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions.error ? (
          <p className="text-sm text-muted">Could not load sessions.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line-soft">
            {(sessions.data ?? []).map((s) => {
              const isCurrent = s.token === current?.session.token;
              return (
                <li key={s.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{deviceLabel(s.userAgent)}</span>
                      {isCurrent ? <Badge tone="brand">This device</Badge> : null}
                    </div>
                    <p className="font-[family-name:var(--font-mono)] text-xs text-muted">
                      {s.ipAddress ?? "unknown IP"} · {formatDateTime(String(s.updatedAt))}
                    </p>
                  </div>
                  {!isCurrent ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={busy === s.token}
                      onClick={() => revoke(s.token)}
                    >
                      Revoke
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Card>
  );
}
