import { describe, expect, it } from "vitest";
import {
  average,
  buildAreaPath,
  buildLinePath,
  donutSegments,
  niceMax,
  type ChartPoint,
} from "../lib/chart";

describe("niceMax", () => {
  it("rounds up to a clean axis bound", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(230)).toBe(250);
    expect(niceMax(1100)).toBe(1500);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(9)).toBe(10);
  });
});

describe("buildLinePath", () => {
  it("returns empty for no points", () => {
    expect(buildLinePath([], 100, 100, 10)).toBe("");
  });

  it("places the first point with M and scales y by max", () => {
    const points: ChartPoint[] = [
      { t: 0, value: 0 },
      { t: 1, value: 10 },
    ];
    const path = buildLinePath(points, 100, 100, 10);
    // first point: x=0, value 0 → y = height (bottom)
    expect(path.startsWith("M0.00 100.00")).toBe(true);
    // second point: x=100, value 10 (==max) → y = 0 (top)
    expect(path).toContain("L100.00 0.00");
  });

  it("guards against a zero max", () => {
    const path = buildLinePath([{ t: 0, value: 5 }], 100, 100, 0);
    expect(path).toBe("M0.00 0.00");
  });
});

describe("average", () => {
  it("returns null for an empty list", () => {
    expect(average([])).toBeNull();
  });
  it("computes the mean", () => {
    expect(average([10, 20, 30])).toBe(20);
  });
});

describe("buildAreaPath", () => {
  it("closes the line down to the baseline and back", () => {
    const points: ChartPoint[] = [
      { t: 0, value: 5 },
      { t: 1, value: 10 },
    ];
    const path = buildAreaPath(points, 100, 100, 10);
    expect(path.startsWith("M0.00 50.00")).toBe(true);
    // drops to the baseline at the last x, returns to x=0, and closes.
    expect(path).toContain("L100.00 100.00 L0.00 100.00 Z");
  });

  it("returns empty for no points", () => {
    expect(buildAreaPath([], 100, 100, 10)).toBe("");
  });
});

describe("donutSegments", () => {
  it("returns one segment per value summing to the whole", () => {
    const segs = donutSegments([1, 1, 2]);
    expect(segs).toHaveLength(3);
    expect(segs[0]!.fraction).toBeCloseTo(0.25);
    expect(segs[2]!.fraction).toBeCloseTo(0.5);
    expect(segs.reduce((s, seg) => s + seg.fraction, 0)).toBeCloseTo(1);
  });

  it("draws a lone full slice as a circle", () => {
    const segs = donutSegments([7]);
    expect(segs).toHaveLength(1);
    expect(segs[0]!.fraction).toBe(1);
    expect(segs[0]!.d).toContain("A");
  });

  it("returns nothing for a zero total", () => {
    expect(donutSegments([0, 0])).toEqual([]);
  });
});
