import { cn } from "@/lib/utils";

export interface HeatCell {
  id: string;
  title: string;
  /** 0..100 (e.g. uptime %), or null for "no data". */
  value: number | null;
}

export interface HeatmapProps {
  cells: HeatCell[];
  /** Maps a value to a CSS color; defaults to a green→red uptime scale. */
  color?: (value: number | null) => string;
  /** Fixed column count; when omitted the grid wraps responsively. */
  columns?: number;
  className?: string;
}

/**
 * Generic heatmap of small colored cells — a GitHub-style calendar for daily
 * uptime, or a single row of region cells. Pure CSS/divs, no dependency.
 */
export function Heatmap({ cells, color = uptimeHeatColor, columns, className }: HeatmapProps) {
  if (cells.length === 0) {
    return (
      <div className="grid h-20 place-items-center rounded-md border border-line-soft bg-panel-2 text-xs text-muted">
        No data for this range
      </div>
    );
  }

  return (
    <div
      className={cn("grid gap-1", columns ? undefined : "grid-cols-[repeat(auto-fill,minmax(14px,1fr))]", className)}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      role="img"
      aria-label="Heatmap"
    >
      {cells.map((cell) => (
        <span
          key={cell.id}
          title={cell.title}
          className="aspect-square rounded-[2px]"
          style={{ backgroundColor: color(cell.value) }}
        />
      ))}
    </div>
  );
}

/** Green (healthy) → amber → red (bad), grey for missing data. */
export function uptimeHeatColor(value: number | null): string {
  if (value === null) return "var(--color-line-soft)";
  if (value >= 99.9) return "var(--color-up)";
  if (value >= 99) return "color-mix(in srgb, var(--color-up) 70%, var(--color-warn))";
  if (value >= 95) return "var(--color-warn)";
  if (value >= 90) return "color-mix(in srgb, var(--color-warn) 60%, var(--color-down))";
  return "var(--color-down)";
}

/** Latency scale: low (good, green) → high (bad, red), relative to `worst`. */
export function latencyHeatColor(worst: number) {
  return (value: number | null): string => {
    if (value === null) return "var(--color-line-soft)";
    const ratio = worst > 0 ? Math.min(1, value / worst) : 0;
    if (ratio <= 0.33) return "var(--color-up)";
    if (ratio <= 0.66) return "var(--color-warn)";
    return "var(--color-down)";
  };
}
