import { describe, expect, it } from "vitest";
import { average, buildLinePath, niceMax, type ChartPoint } from "../lib/chart";

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
