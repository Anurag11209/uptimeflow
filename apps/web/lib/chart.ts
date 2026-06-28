/**
 * Pure chart-math helpers — no React, fully unit-tested. Keeps SVG components
 * dumb and the maths verifiable.
 */

export interface ChartPoint {
  /** Epoch millis (x). */
  t: number;
  /** Value (y), e.g. response time in ms. */
  value: number;
}

export interface DailyAvailability {
  day: string;
  uptimePct: number;
}

/** Round a max value up to a clean axis bound (e.g. 230 → 250, 1100 → 1500). */
export function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const steps = [1, 1.5, 2, 2.5, 5, 10];
  for (const step of steps) {
    const candidate = step * pow;
    if (candidate >= raw) return Math.round(candidate);
  }
  return Math.round(10 * pow);
}

/**
 * Build an SVG polyline path for points spread evenly across `width`, scaled so
 * `max` maps to the top. Time order is assumed ascending; callers sort first.
 */
export function buildLinePath(
  points: ChartPoint[],
  width: number,
  height: number,
  max: number,
): string {
  if (points.length === 0) return "";
  const safeMax = max <= 0 ? 1 : max;
  const stepX = points.length > 1 ? width / (points.length - 1) : 0;
  return points
    .map((p, i) => {
      const x = i * stepX;
      // Clamp the value into [0, max] so a point never renders outside the box.
      const clamped = Math.min(safeMax, Math.max(0, p.value));
      const y = height - (clamped / safeMax) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

/** Average of a numeric list, or null when empty. */
export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Build a closed SVG area path: the line over `points`, dropped to the baseline
 * and back, so it can be filled. Shares the line geometry with buildLinePath.
 */
export function buildAreaPath(
  points: ChartPoint[],
  width: number,
  height: number,
  max: number,
): string {
  if (points.length === 0) return "";
  const line = buildLinePath(points, width, height, max);
  const lastX = points.length > 1 ? width : 0;
  return `${line} L${lastX.toFixed(2)} ${height.toFixed(2)} L0.00 ${height.toFixed(2)} Z`;
}

/**
 * SVG arc segments for a donut/pie chart. Returns one path `d` per value with
 * its fraction of the whole, so callers can color and label each slice. A
 * zero total yields an empty list.
 */
export function donutSegments(
  values: number[],
  radius = 16,
  cx = 18,
  cy = 18,
): { d: string; fraction: number }[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  let angle = -Math.PI / 2; // start at 12 o'clock
  return values.map((v) => {
    const fraction = v / total;
    const next = angle + fraction * Math.PI * 2;
    const x1 = cx + radius * Math.cos(angle);
    const y1 = cy + radius * Math.sin(angle);
    const x2 = cx + radius * Math.cos(next);
    const y2 = cy + radius * Math.sin(next);
    const largeArc = fraction > 0.5 ? 1 : 0;
    // A single arc can't close a full circle — nudge the endpoint for a lone slice.
    const d =
      fraction >= 1
        ? `M${cx} ${cy - radius} A${radius} ${radius} 0 1 1 ${(cx - 0.001).toFixed(3)} ${cy - radius} Z`
        : `M${cx} ${cy} L${x1.toFixed(3)} ${y1.toFixed(3)} A${radius} ${radius} 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z`;
    angle = next;
    return { d, fraction };
  });
}
