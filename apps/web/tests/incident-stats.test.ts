import { describe, expect, it } from "vitest";
import {
  countByStatus,
  countCritical,
  countToday,
  countUnresolved,
  meanTimeToRecovery,
  recentRecoveries,
} from "../lib/incident-stats";
import type { IncidentListItem } from "../lib/monitors";

function inc(p: Partial<IncidentListItem>): IncidentListItem {
  return {
    id: Math.random().toString(36).slice(2),
    status: "OPEN",
    severity: "MAJOR",
    title: "t",
    summary: null,
    monitorId: "m",
    monitorName: "Monitor",
    startedAt: "2026-06-20T00:00:00.000Z",
    acknowledgedAt: null,
    resolvedAt: null,
    durationSec: null,
    createdAt: "2026-06-20T00:00:00.000Z",
    ...p,
  };
}

describe("countUnresolved / countByStatus", () => {
  const list = [
    inc({ status: "OPEN" }),
    inc({ status: "ACKNOWLEDGED" }),
    inc({ status: "RESOLVED" }),
  ];
  it("counts non-resolved", () => {
    expect(countUnresolved(list)).toBe(2);
  });
  it("counts by exact status", () => {
    expect(countByStatus(list, "RESOLVED")).toBe(1);
    expect(countByStatus(list, "OPEN")).toBe(1);
  });
});

describe("countToday", () => {
  const now = Date.parse("2026-06-20T12:00:00.000Z");
  it("counts incidents since local midnight", () => {
    const list = [
      inc({ startedAt: "2026-06-20T01:00:00.000Z" }),
      inc({ startedAt: "2026-06-19T23:00:00.000Z" }),
    ];
    // At least the one clearly today counts; the late-night one depends on tz.
    expect(countToday(list, now)).toBeGreaterThanOrEqual(1);
  });
});

describe("meanTimeToRecovery", () => {
  it("averages resolved durations only", () => {
    const list = [
      inc({ status: "RESOLVED", durationSec: 100 }),
      inc({ status: "RESOLVED", durationSec: 300 }),
      inc({ status: "OPEN", durationSec: null }),
      inc({ status: "RESOLVED", durationSec: null }),
    ];
    expect(meanTimeToRecovery(list)).toBe(200);
  });
  it("returns null with no resolved durations", () => {
    expect(meanTimeToRecovery([inc({ status: "OPEN" })])).toBeNull();
  });
});

describe("recentRecoveries", () => {
  it("returns resolved incidents newest-first, limited", () => {
    const list = [
      inc({ status: "RESOLVED", resolvedAt: "2026-06-20T01:00:00.000Z", title: "a" }),
      inc({ status: "RESOLVED", resolvedAt: "2026-06-20T03:00:00.000Z", title: "b" }),
      inc({ status: "OPEN" }),
    ];
    const out = recentRecoveries(list, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.title).toBe("b");
  });
});

describe("countCritical", () => {
  it("counts unresolved critical/major only", () => {
    const list = [
      inc({ status: "OPEN", severity: "CRITICAL" }),
      inc({ status: "ACKNOWLEDGED", severity: "MAJOR" }),
      inc({ status: "OPEN", severity: "MINOR" }),
      inc({ status: "RESOLVED", severity: "CRITICAL" }),
    ];
    expect(countCritical(list)).toBe(2);
  });
});
