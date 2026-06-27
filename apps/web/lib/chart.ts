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
