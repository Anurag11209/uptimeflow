import { useId } from "react";
import { cn } from "@/lib/utils";
import { buildAreaPath, buildLinePath, niceMax, type ChartPoint } from "@/lib/chart";

export type ChartTone = "brand" | "up" | "down";

const TONE_VAR: Record<ChartTone, string> = {
  brand: "var(--color-brand)",
  up: "var(--color-up)",
  down: "var(--color-down)",
};

export interface AreaChartProps {
  points: ChartPoint[];
  label: string;
  unit?: string;
  tone?: ChartTone;
  /** Override the auto y-max (e.g. 100 for percentages). */
  max?: number;
  className?: string;
  height?: number;
}

/**
 * Dependency-free SVG area chart — a filled line with a soft vertical gradient.
 * Extends the existing hand-rolled chart family (LineChart) rather than pulling
 * in a charting library.
 */
export function AreaChart({
  points,
  label,
  unit = "",
  tone = "brand",
  max: maxOverride,
  className,
  height = 160,
}: AreaChartProps) {
  const gradientId = useId();

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
  const max = maxOverride ?? niceMax(Math.max(...points.map((p) => p.value)));
  const line = buildLinePath(points, width, height, max);
  const area = buildAreaPath(points, width, height, max);
  const color = TONE_VAR[tone];
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
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <path d={area} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={color}
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
