import { cn } from "@/lib/utils";
import { niceMax } from "@/lib/chart";

export type BarTone = "brand" | "up" | "down" | "muted";

const TONE_BG: Record<BarTone, string> = {
  brand: "bg-brand",
  up: "bg-up",
  down: "bg-down",
  muted: "bg-muted",
};

export interface BarDatum {
  label: string;
  value: number;
  tone?: BarTone;
  /** Optional richer label shown on hover. */
  title?: string;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Formats the value shown in the hover title + caption. */
  format?: (value: number) => string;
  tone?: BarTone;
  className?: string;
  height?: number;
}

/**
 * Vertical bar chart built from flex columns + Tailwind heights — same
 * dependency-free approach as AvailabilityChart, generalized for categorical
 * data (incident frequency, severity counts, monthly trends).
 */
export function BarChart({
  data,
  format = (v) => String(v),
  tone = "brand",
  className,
  height = 160,
}: BarChartProps) {
  if (data.length === 0) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-md border border-line-soft bg-panel-2 text-xs text-muted",
          className,
        )}
        style={{ height }}
      >
        No data for this range
      </div>
    );
  }

  const max = niceMax(Math.max(...data.map((d) => d.value), 0));

  return (
    <figure className={cn("w-full", className)}>
      <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label="Bar chart">
        {data.map((d, i) => {
          const pctH = max > 0 ? Math.max(2, (d.value / max) * 100) : 2;
          return (
            <div key={`${d.label}-${i}`} className="flex flex-1 flex-col items-center justify-end gap-1">
              <div
                className={cn("w-full rounded-t-sm transition-all", TONE_BG[d.tone ?? tone])}
                style={{ height: `${pctH}%` }}
                title={d.title ?? `${d.label}: ${format(d.value)}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        {data.map((d, i) => (
          <span
            key={`${d.label}-${i}`}
            className="flex-1 truncate text-center font-[family-name:var(--font-mono)] text-[10px] text-muted"
            title={d.label}
          >
            {d.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
