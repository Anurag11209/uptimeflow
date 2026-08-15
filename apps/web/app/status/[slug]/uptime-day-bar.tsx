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
 * Row of daily uptime bars with touch and keyboard accessible inspection.
 * Supports hover, touch tap, and keyboard focus.
 */
export function UptimeDayBar({ name, overallLabel, days }: UptimeDayBarProps) {
  const uid = useId();
  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  return (
    <div
      className="flex h-8 items-end gap-px"
      role="group"
      aria-label={`${name} ${overallLabel} uptime`}
    >
      {days.map((d, i) => {
        const isActive = activeIdx === i;
        const dayFormatted = formatDay(d.day);
        const uptimeFormatted = formatUptime(d.uptimePct);

        return (
          <div key={`${uid}-${d.day}`} className="relative flex h-full flex-1 items-end">
            <button
              type="button"
              aria-label={`${dayFormatted}: ${uptimeFormatted} uptime`}
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx((curr) => (curr === i ? null : curr))}
              onFocus={() => setActiveIdx(i)}
              onBlur={() => setActiveIdx((curr) => (curr === i ? null : curr))}
              onClick={() => setActiveIdx((curr) => (curr === i ? null : i))}
              className={cn(
                "h-full w-full min-w-[2px] rounded-[1px] transition-all duration-100",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
                uptimeBarColor(d.uptimePct),
                isActive && "scale-y-110 brightness-110",
              )}
            />
            {isActive ? (
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max -translate-x-1/2 rounded-md border border-line bg-panel-2 px-2.5 py-1.5 text-xs shadow-lg"
                role="tooltip"
              >
                <p className="font-medium text-text">{dayFormatted}</p>
                <p className="text-muted">{uptimeFormatted} uptime</p>
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
