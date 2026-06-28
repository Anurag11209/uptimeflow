import { describe, expect, it } from "vitest";
import {
  averageAvailability,
  bucketDaily,
  failureRate,
  formatDuration,
  formatPct,
  severityMeta,
  uptimeBand,
  type DailyPoint,
} from "../lib/analytics";

function pt(day: string, over: Partial<DailyPoint> = {}): DailyPoint {
  return { day, uptimePct: 100, avgResponseMs: 200, totalChecks: 100, failedChecks: 0, ...over };
}

describe("bucketDaily", () => {
  it("returns the input unchanged for the day bucket", () => {
    const points = [pt("2026-06-01"), pt("2026-06-02")];
    expect(bucketDaily(points, "day")).toBe(points);
  });

  it("groups by calendar month and re-weights uptime by checks", () => {
    const points = [
      pt("2026-05-31", { totalChecks: 100, failedChecks: 0, uptimePct: 100 }),
      pt("2026-06-01", { totalChecks: 100, failedChecks: 50, uptimePct: 50 }),
      pt("2026-06-02", { totalChecks: 100, failedChecks: 10, uptimePct: 90 }),
    ];
    const monthly = bucketDaily(points, "month");
    expect(monthly).toHaveLength(2);
    // June: (200 - 60) / 200 = 70%
    const june = monthly[1]!;
    expect(june.totalChecks).toBe(200);
    expect(june.failedChecks).toBe(60);
    expect(june.uptimePct).toBe(70);
  });

  it("groups by ISO week", () => {
    // 2026-06-01 is a Monday; 2026-06-08 the next Monday → two weeks.
    const weekly = bucketDaily([pt("2026-06-01"), pt("2026-06-03"), pt("2026-06-08")], "week");
    expect(weekly).toHaveLength(2);
  });

  it("averages response time only over days that reported data", () => {
    const points = [
      pt("2026-06-01", { avgResponseMs: 100 }),
      pt("2026-06-02", { avgResponseMs: null }),
      pt("2026-06-03", { avgResponseMs: 300 }),
    ];
    expect(bucketDaily(points, "month")[0]!.avgResponseMs).toBe(200);
  });
});

describe("failureRate", () => {
  it("computes failed / total across the window", () => {
    expect(failureRate([pt("d1", { totalChecks: 100, failedChecks: 5 }), pt("d2", { totalChecks: 100, failedChecks: 15 })])).toBe(10);
  });
  it("returns null when there are no checks", () => {
    expect(failureRate([pt("d1", { totalChecks: 0, failedChecks: 0 })])).toBeNull();
  });
});

describe("averageAvailability", () => {
  it("averages only days with data", () => {
    expect(
      averageAvailability([pt("d1", { uptimePct: 100 }), pt("d2", { uptimePct: null }), pt("d3", { uptimePct: 98 })]),
    ).toBe(99);
  });
  it("returns null with no data", () => {
    expect(averageAvailability([pt("d1", { uptimePct: null })])).toBeNull();
  });
});

describe("formatDuration", () => {
  it("formats across units", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 300)).toBe("1h 5m");
    expect(formatDuration(86_400 + 3600 * 3)).toBe("1d 3h");
  });
});

describe("formatPct", () => {
  it("formats and guards null", () => {
    expect(formatPct(99.954)).toBe("99.95%");
    expect(formatPct(null)).toBe("—");
  });
});

describe("severityMeta & uptimeBand", () => {
  it("maps severities to tones", () => {
    expect(severityMeta("CRITICAL").tone).toBe("down");
    expect(severityMeta("MINOR").tone).toBe("brand");
  });
  it("bands uptime values", () => {
    expect(uptimeBand(99.95)).toBe("up");
    expect(uptimeBand(98)).toBe("brand");
    expect(uptimeBand(80)).toBe("down");
    expect(uptimeBand(null)).toBe("muted");
  });
});
