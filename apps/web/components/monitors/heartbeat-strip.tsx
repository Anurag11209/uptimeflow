"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { checkStatusMeta, type CheckStatus, type RecentCheckPoint } from "@/lib/monitors";

const TICK_TONE_BG: Record<CheckStatus, string> = {
  UP: "bg-up",
  DOWN: "bg-down",
  DEGRADED: "bg-warn",
  TIMEOUT: "bg-down",
  ERROR: "bg-down",
};

interface HeartbeatStripProps {
  checks: RecentCheckPoint[];
  /** Total slots to render; missing history is padded with empty ticks on the left. */
  size?: number;
  className?: string;
}

/**
 * Row of colored ticks summarizing a monitor's most recent checks, oldest → newest.
 * Modeled on Uptime Kuma's heartbeat bar and OpenStatus's status bar: a compact,
 * scannable trend that lets you see health without opening the monitor.
 */
export function HeartbeatStrip({ checks, size = 24, className }: HeartbeatStripProps) {
  const uid = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  const padCount = Math.max(0, size - checks.length);
  const slots: (RecentCheckPoint | null)[] = [
    ...Array.from({ length: padCount }, () => null),
    ...checks.slice(-size),
  ];

  return (
    <div
      className={cn("group/strip flex h-6 items-center gap-[3px]", className)}
      role="img"
      aria-label={summarize(checks)}
    >
      {slots.map((check, i) => {
        const key = `${uid}-${i}`;
        const isHovered = hovered === i && check !== null;
        return (
          <div key={key} className="relative flex h-full flex-1 items-center">
            <button
              type="button"
              tabIndex={-1}
              onMouseEnter={() => check && setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              className={cn(
                "h-4 w-full min-w-[3px] rounded-[1px] transition-[height,transform] duration-100",
                check ? TICK_TONE_BG[check.status] : "bg-line",
                isHovered && "h-6 scale-y-100",
              )}
              aria-hidden
            />
            {isHovered && check ? (
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-48 -translate-x-1/2 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-lg"
                role="tooltip"
              >
                <p className="font-medium text-text">{checkStatusMeta(check.status).label}</p>
                <p className="text-muted">{formatTickTime(check.checkedAt)}</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatTickTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function summarize(checks: RecentCheckPoint[]): string {
  if (checks.length === 0) return "No recent check history";
  const upCount = checks.filter((c) => c.status === "UP").length;
  return `${upCount} of ${checks.length} recent checks up`;
}
