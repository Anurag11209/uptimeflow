import { cn } from "@/lib/utils";
import { donutSegments } from "@/lib/chart";

export interface DonutSlice {
  label: string;
  value: number;
  /** CSS color for the slice (defaults cycle through the brand palette). */
  color?: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  /** Center label (e.g. total count). */
  centerLabel?: string;
  centerSubLabel?: string;
  className?: string;
}

// On-theme palette using design tokens + a couple of complementary hues so a
// distribution with many buckets stays readable.
const PALETTE = [
  "var(--color-down)",
  "var(--color-brand)",
  "var(--color-up)",
  "#6aa3ff",
  "#b48bff",
  "var(--color-muted)",
];

/**
 * Dependency-free SVG donut chart for distributions (severity, root cause).
 * Geometry comes from the tested donutSegments() helper.
 */
export function DonutChart({ slices, centerLabel, centerSubLabel, className }: DonutChartProps) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total <= 0) {
    return (
      <div
        className={cn(
          "grid h-40 place-items-center rounded-md border border-line-soft bg-panel-2 text-xs text-muted",
          className,
        )}
      >
        No data for this range
      </div>
    );
  }

  const segments = donutSegments(slices.map((s) => s.value));
  const colorFor = (i: number) => slices[i]?.color ?? PALETTE[i % PALETTE.length];

  return (
    <div className={cn("flex flex-wrap items-center gap-6", className)}>
      <svg viewBox="0 0 36 36" className="size-32 shrink-0" role="img" aria-label="Distribution">
        {segments.map((seg, i) => (
          <path key={i} d={seg.d} fill={colorFor(i)} stroke="var(--color-panel)" strokeWidth={0.4} />
        ))}
        {/* Punch out the center for the donut hole. */}
        <circle cx="18" cy="18" r="9" fill="var(--color-panel)" />
        {centerLabel ? (
          <text
            x="18"
            y={centerSubLabel ? "17.5" : "19"}
            textAnchor="middle"
            className="fill-text font-[family-name:var(--font-display)]"
            style={{ fontSize: "5px", fontWeight: 600 }}
          >
            {centerLabel}
          </text>
        ) : null}
        {centerSubLabel ? (
          <text
            x="18"
            y="22"
            textAnchor="middle"
            className="fill-muted"
            style={{ fontSize: "2.6px" }}
          >
            {centerSubLabel}
          </text>
        ) : null}
      </svg>

      <ul className="flex flex-col gap-1.5 text-sm">
        {slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ backgroundColor: colorFor(i) }} />
            <span className="text-text">{s.label}</span>
            <span className="text-muted">
              {s.value} ({Math.round((s.value / total) * 100)}%)
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
