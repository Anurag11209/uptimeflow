import { describe, expect, it } from "vitest";
import {
  componentStatusMeta,
  formatUptime,
  incidentStatusLabel,
  isAllOperational,
  overallHeadline,
  uptimeBarColor,
  uptimeTone,
} from "../lib/status";

describe("status presentation helpers", () => {
  it("maps component status to label + tone", () => {
    expect(componentStatusMeta("OPERATIONAL")).toMatchObject({ label: "Operational", tone: "up" });
    expect(componentStatusMeta("MAJOR_OUTAGE")).toMatchObject({ label: "Major outage", tone: "down" });
    expect(componentStatusMeta("UNDER_MAINTENANCE").tone).toBe("muted");
  });

  it("summarizes the overall headline", () => {
    expect(overallHeadline("OPERATIONAL")).toBe("All systems operational");
    expect(overallHeadline("PARTIAL_OUTAGE")).toBe("Partial outage");
    expect(isAllOperational("OPERATIONAL")).toBe(true);
    expect(isAllOperational("DEGRADED_PERFORMANCE")).toBe(false);
  });

  it("labels incident statuses", () => {
    expect(incidentStatusLabel("INVESTIGATING")).toBe("Investigating");
    expect(incidentStatusLabel("RESOLVED")).toBe("Resolved");
  });

  it("formats uptime percentages", () => {
    expect(formatUptime(99.98)).toBe("99.98%");
    expect(formatUptime(100)).toBe("100.00%");
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(undefined)).toBe("—");
    expect(formatUptime(Number.NaN)).toBe("—");
  });

  it("bands uptime into tones and bar colors", () => {
    expect(uptimeTone(99.95)).toBe("up");
    expect(uptimeTone(98)).toBe("brand");
    expect(uptimeTone(80)).toBe("down");
    expect(uptimeTone(null)).toBe("muted");

    expect(uptimeBarColor(100)).toBe("bg-up");
    expect(uptimeBarColor(97)).toBe("bg-warn");
    expect(uptimeBarColor(50)).toBe("bg-down");
    expect(uptimeBarColor(null)).toBe("bg-line");
  });
});
