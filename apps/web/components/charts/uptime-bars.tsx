import { cn } from "@/lib/utils";
import type { CheckStatus } from "@/lib/monitors";

export interface UptimeCell {
  status: CheckStatus | "EMPTY";
  title: string;
}

const cellTone: Record<UptimeCell["status"], string> = {
  UP: "bg-up",
  DEGRADED: "bg-warn",
  DOWN: "bg-down",
  ERROR: "bg-down",
  TIMEOUT: "bg-down",
  EMPTY: "bg-line-soft",
};

/**
 * Compact availability strip — one bar per recent check. Mirrors the public
 * status-page visual language. Used on the list rows and the detail header.
 */
export function UptimeBars({
  cells,
  className,
}: {
  cells: UptimeCell[];
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-end gap-0.5", className)}
      role="img"
      aria-label="Recent check history"
    >
      {cells.map((cell, i) => (
        <span
          key={i}
          title={cell.title}
          className={cn("h-6 w-1.5 rounded-sm", cellTone[cell.status])}
        />
      ))}
    </div>
  );
}
