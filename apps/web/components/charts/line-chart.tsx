import { cn } from "@/lib/utils";
import { buildLinePath, niceMax, type ChartPoint } from "@/lib/chart";

export interface LineChartProps {
  points: ChartPoint[];
  /** Accessible description of what the line represents. */
  label: string;
  unit?: string;
  className?: string;
  height?: number;
}

/**
 * Dependency-free SVG line chart (response time over time). Pure-SVG keeps it
 * consistent with the brand PulseLine and avoids a charting dependency.
 */
export function LineChart({
  points,
  label,
  unit = "",
  className,
  height = 160,
}: LineChartProps) {
  if (points.length < 2) {
    return (
      <div
        className={cn(
          "grid place-items-center rounded-md border border-line-soft bg-panel-2 text-xs text-muted",
          className,
        )}
        style={{ height }}
      >
        Not enough data yet
      </div>
    );
  }

  const width = 600;
  const max = niceMax(Math.max(...points.map((p) => p.value)));
  const path = buildLinePath(points, width, height, max);
  const last = points[points.length - 1]!;

  return (
    <figure className={cn("w-full", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-40 w-full"
        role="img"
        aria-label={`${label}: latest ${Math.round(last.value)}${unit}`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={width}
            y1={height * f}
            y2={height * f}
            stroke="currentColor"
            className="text-line-soft"
            strokeWidth={1}
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          className="text-brand"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <figcaption className="mt-1 flex justify-between font-[family-name:var(--font-mono)] text-[10px] text-muted">
        <span>0{unit}</span>
        <span>
          {max}
          {unit} max
        </span>
      </figcaption>
    </figure>
  );
}
