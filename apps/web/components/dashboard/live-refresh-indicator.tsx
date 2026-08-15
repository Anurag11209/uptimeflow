"use client";

import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { Pause, Play, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveRefreshIndicatorProps {
  intervalSeconds?: number;
  /** Scopes refetches to this org's queries instead of the whole cache. */
  orgId?: string;
  className?: string;
}

export function LiveRefreshIndicator({
  intervalSeconds = 30,
  orgId,
  className,
}: LiveRefreshIndicatorProps) {
  const queryClient = useQueryClient();
  const isFetching = useIsFetching();
  const [secondsRemaining, setSecondsRemaining] = useState(intervalSeconds);
  const [paused, setPaused] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());

  function refetchAll() {
    // Scope to this org's data when known, rather than invalidating every
    // query in the app (settings, billing, unrelated orgs) on every tick.
    void queryClient.invalidateQueries(orgId ? { queryKey: ["org", orgId] } : undefined);
  }

  function triggerRefresh() {
    setSecondsRemaining(intervalSeconds);
    setLastRefreshedAt(new Date());
    refetchAll();
  }

  useEffect(() => {
    if (paused) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          refetchAll();
          setLastRefreshedAt(new Date());
          return intervalSeconds;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
    // refetchAll is intentionally omitted: it's stable in effect (only reads
    // orgId/queryClient, both already deps) and re-including it would force
    // this effect to re-run every render since it's redefined each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, intervalSeconds, orgId]);

  const isUpdating = isFetching > 0;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border border-line-soft bg-panel-2/80 px-3 py-1 text-xs text-muted backdrop-blur",
        className,
      )}
      role="status"
      aria-label="Live data refresh status"
    >
      <span className="flex items-center gap-1.5 font-medium">
        <span
          className={cn(
            "size-2 rounded-full",
            paused
              ? "bg-muted/60"
              : isUpdating
                ? "bg-brand animate-pulse"
                : "bg-up status-dot",
          )}
        />
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-text">
          {paused
            ? "Paused"
            : isUpdating
              ? "Updating…"
              : `Live (${secondsRemaining}s)`}
        </span>
      </span>

      <div className="flex items-center gap-1 border-l border-line-soft pl-1.5">
        <button
          type="button"
          onClick={triggerRefresh}
          disabled={isUpdating}
          title="Refresh dashboard data now"
          aria-label="Refresh now"
          className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text disabled:opacity-50"
        >
          <RefreshCw
            className={cn("size-3.5", isUpdating && "animate-spin text-brand")}
          />
        </button>

        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          title={paused ? "Resume live updates" : "Pause live auto-refresh"}
          aria-label={paused ? "Resume live updates" : "Pause live auto-refresh"}
          className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text"
        >
          {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
        </button>
      </div>
    </div>
  );
}
