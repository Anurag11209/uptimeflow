"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { formatUptime, uptimeBarColor, type StatusHistoryDay } from "@/lib/status";

interface UptimeDayBarProps {
  name: string;
  overallLabel: string;
  days: StatusHistoryDay[];
}

/**
 * Row of daily uptime bars with a hover tooltip, modeled on OpenStatus's
 * status-bar pattern: thin flex-1 bars, gap-px, taller on hover.
 */
export function UptimeDayBar({ name, overallLabel, days }: UptimeDayBarProps) {
  const uid = useId();
  const [hovered, setHovered] = useState<number | null>(null);

  return (
    <div
      className="flex h-8 items-end gap-px"
      role="img"
      aria-label={`${name} ${overallLabel} uptime`}
    >
      {days.map((d, i) => {
        const isHovered = hovered === i;
        return (
          <div key={`${uid}-${d.day}`} className="relative flex h-full flex-1 items-end">
            <button
              type="button"
              tabIndex={-1}
              aria-hidden
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered((h) => (h === i ? null : h))}
              className={cn(
                "h-full w-full min-w-[2px] rounded-[1px] transition-transform duration-100",
                uptimeBarColor(d.uptimePct),
                isHovered && "scale-y-105",
              )}
            />
            {isHovered ? (
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-lg"
                role="tooltip"
              >
                <p className="font-medium text-text">{formatDay(d.day)}</p>
                <p className="text-muted">{formatUptime(d.uptimePct)} uptime</p>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatDay(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}
