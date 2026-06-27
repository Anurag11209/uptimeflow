import { describe, expect, it } from "vitest";
import {
  averageLatency,
  checkStatusMeta,
  formatInterval,
  formatRelativeTime,
  formatResponseMs,
  formatUptimePercent,
  healthMeta,
  incidentStatusMeta,
  monitorTarget,
  monitorTypeLabel,
  regionLabel,
  toDailyAvailability,
  toLatencyPoints,
  uptimePercent,
  type CheckResultItem,
} from "../lib/monitors";

function check(partial: Partial<CheckResultItem>): CheckResultItem {
  return {
    id: "c",
    region: "NA_EAST",
    status: "UP",
    statusCode: 200,
    responseMs: 100,
    errorType: null,
    errorMessage: null,
    checkedAt: "2026-06-20T00:00:00.000Z",
    ...partial,
  };
}

describe("monitorTarget", () => {
  it("prefers the URL", () => {
    expect(monitorTarget({ url: "https://x.com", host: null, port: null })).toBe(
      "https://x.com",
    );
  });
  it("falls back to host:port", () => {
    expect(monitorTarget({ url: null, host: "db", port: 5432 })).toBe("db:5432");
    expect(monitorTarget({ url: null, host: "db", port: null })).toBe("db");
  });
  it("returns a dash when nothing is set", () => {
    expect(monitorTarget({ url: null, host: null, port: null })).toBe("—");
  });
});

describe("formatResponseMs", () => {
  it("formats ms and seconds", () => {
    expect(formatResponseMs(null)).toBe("—");
    expect(formatResponseMs(250)).toBe("250 ms");
    expect(formatResponseMs(1500)).toBe("1.50 s");
  });
});

describe("formatInterval", () => {
  it("scales to the largest sensible unit", () => {
    expect(formatInterval(30)).toBe("30s");
    expect(formatInterval(60)).toBe("1m");
    expect(formatInterval(300)).toBe("5m");
    expect(formatInterval(3600)).toBe("1h");
    expect(formatInterval(86_400)).toBe("1d");
  });
});

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-06-20T01:00:00.000Z");
  it("handles null and bad input", () => {
    expect(formatRelativeTime(null, now)).toBe("Never");
    expect(formatRelativeTime("not-a-date", now)).toBe("—");
  });
  it("formats buckets", () => {
    expect(formatRelativeTime("2026-06-20T00:59:55.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-06-20T00:59:00.000Z", now)).toBe("1m ago");
    expect(formatRelativeTime("2026-06-20T00:00:00.000Z", now)).toBe("1h ago");
    expect(formatRelativeTime("2026-06-19T01:00:00.000Z", now)).toBe("1d ago");
  });
});

describe("uptimePercent", () => {
  it("counts UP and DEGRADED as available", () => {
    expect(uptimePercent([])).toBe(0);
    expect(
      uptimePercent([
        { status: "UP" },
        { status: "DEGRADED" },
        { status: "DOWN" },
        { status: "ERROR" },
      ]),
    ).toBe(50);
  });
});

describe("formatUptimePercent", () => {
  it("shows whole 100 and 2dp otherwise", () => {
    expect(formatUptimePercent(100)).toBe("100%");
    expect(formatUptimePercent(99.5)).toBe("99.50%");
    expect(formatUptimePercent(0)).toBe("0%");
  });
});

describe("averageLatency", () => {
  it("ignores null response times", () => {
    expect(
      averageLatency([
        check({ responseMs: 100 }),
        check({ responseMs: 300 }),
        check({ responseMs: null }),
      ]),
    ).toBe(200);
    expect(averageLatency([check({ responseMs: null })])).toBeNull();
  });
});

describe("toLatencyPoints", () => {
  it("filters out null latency and sorts ascending by time", () => {
    const points = toLatencyPoints([
      check({ checkedAt: "2026-06-20T00:00:02.000Z", responseMs: 20 }),
      check({ checkedAt: "2026-06-20T00:00:01.000Z", responseMs: 10 }),
      check({ checkedAt: "2026-06-20T00:00:03.000Z", responseMs: null }),
    ]);
    expect(points.map((p) => p.value)).toEqual([10, 20]);
  });
});

describe("toDailyAvailability", () => {
  it("buckets by UTC day and computes uptime per day", () => {
    const days = toDailyAvailability([
      check({ checkedAt: "2026-06-20T01:00:00.000Z", status: "UP" }),
      check({ checkedAt: "2026-06-20T02:00:00.000Z", status: "DOWN" }),
      check({ checkedAt: "2026-06-21T01:00:00.000Z", status: "UP" }),
    ]);
    expect(days).toEqual([
      { day: "2026-06-20", uptimePct: 50 },
      { day: "2026-06-21", uptimePct: 100 },
    ]);
  });
});

describe("meta helpers", () => {
  it("maps health to label + tone", () => {
    expect(healthMeta("UP")).toEqual({ label: "Up", tone: "up" });
    expect(healthMeta("DOWN")).toEqual({ label: "Down", tone: "down" });
    expect(healthMeta("PENDING").tone).toBe("muted");
  });
  it("maps check status and incident status", () => {
    expect(checkStatusMeta("TIMEOUT").tone).toBe("down");
    expect(incidentStatusMeta("OPEN").tone).toBe("down");
    expect(incidentStatusMeta("RESOLVED").tone).toBe("up");
  });
  it("labels types and regions", () => {
    expect(monitorTypeLabel("HTTP")).toBe("HTTP(S)");
    expect(monitorTypeLabel("SSL")).toBe("SSL certificate");
    expect(regionLabel("EU_WEST")).toBe("Europe (West)");
  });
});
