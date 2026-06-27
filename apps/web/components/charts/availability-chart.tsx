import { cn } from "@/lib/utils";
import type { DailyAvailability } from "@/lib/chart";

/**
 * Daily availability column chart (uptime % per day) — pure SVG/CSS bars.
 */
export function AvailabilityChart({
  days,
  className,
}: {
  days: DailyAvailability[];
  className?: string;
}) {
  if (days.length === 0) {
    return (
      <div
        className={cn(
          "grid h-40 place-items-center rounded-md border border-line-soft bg-panel-2 text-xs text-muted",
          className,
        )}
      >
        No availability data yet
      </div>
    );
  }

  return (
    <div className={cn("flex h-40 items-end gap-1", className)}>
      {days.map((d) => {
        const tone =
          d.uptimePct >= 99.9 ? "bg-up" : d.uptimePct >= 95 ? "bg-warn" : "bg-down";
        return (
          <div
            key={d.day}
            className="flex flex-1 flex-col items-center justify-end gap-1"
            title={`${d.day}: ${d.uptimePct.toFixed(2)}% uptime`}
          >
            <div
              className={cn("w-full rounded-sm", tone)}
              style={{ height: `${Math.max(2, d.uptimePct)}%` }}
              role="img"
              aria-label={`${d.day}: ${d.uptimePct.toFixed(2)} percent uptime`}
            />
          </div>
        );
      })}
    </div>
  );
}
