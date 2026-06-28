import { describe, expect, it } from "vitest";
import { fmtDateRange, windowStatus, type MaintenanceWindow } from "../lib/maintenance-windows";

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeWindow(partial: Partial<MaintenanceWindow>): MaintenanceWindow {
  return {
    id: "wnd-1",
    organizationId: "org-1",
    title: "Scheduled maintenance",
    description: null,
    startsAt: "2026-06-20T10:00:00.000Z",
    endsAt: "2026-06-20T12:00:00.000Z",
    recurrenceRule: null,
    suppressAlerts: true,
    createdById: null,
    createdAt: "2026-06-19T08:00:00.000Z",
    updatedAt: "2026-06-19T08:00:00.000Z",
    deletedAt: null,
    monitors: [],
    ...partial,
  };
}

// ─── windowStatus ─────────────────────────────────────────────────────────────

describe("windowStatus", () => {
  it("returns 'upcoming' when now is before the start time", () => {
    const w = makeWindow({
      startsAt: "2026-06-20T10:00:00.000Z",
      endsAt: "2026-06-20T12:00:00.000Z",
    });
    // now = 1 hour before start
    const now = Date.parse("2026-06-20T09:00:00.000Z");
    expect(windowStatus(w, now)).toBe("upcoming");
  });

  it("returns 'active' when now is between start and end", () => {
    const w = makeWindow({
      startsAt: "2026-06-20T10:00:00.000Z",
      endsAt: "2026-06-20T12:00:00.000Z",
    });
    const now = Date.parse("2026-06-20T11:00:00.000Z");
    expect(windowStatus(w, now)).toBe("active");
  });

  it("returns 'active' at exactly the start boundary", () => {
    const w = makeWindow({
      startsAt: "2026-06-20T10:00:00.000Z",
      endsAt: "2026-06-20T12:00:00.000Z",
    });
    const now = Date.parse("2026-06-20T10:00:00.000Z");
    expect(windowStatus(w, now)).toBe("active");
  });

  it("returns 'active' at exactly the end boundary", () => {
    const w = makeWindow({
      startsAt: "2026-06-20T10:00:00.000Z",
      endsAt: "2026-06-20T12:00:00.000Z",
    });
    const now = Date.parse("2026-06-20T12:00:00.000Z");
    expect(windowStatus(w, now)).toBe("active");
  });

  it("returns 'past' when now is after the end time", () => {
    const w = makeWindow({
      startsAt: "2026-06-20T10:00:00.000Z",
      endsAt: "2026-06-20T12:00:00.000Z",
    });
    const now = Date.parse("2026-06-20T13:00:00.000Z");
    expect(windowStatus(w, now)).toBe("past");
  });

  it("handles a window that has already fully passed", () => {
    const w = makeWindow({
      startsAt: "2026-06-01T00:00:00.000Z",
      endsAt: "2026-06-01T02:00:00.000Z",
    });
    const now = Date.parse("2026-06-20T12:00:00.000Z");
    expect(windowStatus(w, now)).toBe("past");
  });
});

// ─── fmtDateRange ─────────────────────────────────────────────────────────────

describe("fmtDateRange", () => {
  it("returns a non-empty string with an arrow separator", () => {
    const result = fmtDateRange("2026-06-20T10:00:00.000Z", "2026-06-20T12:00:00.000Z");
    expect(result).toContain("→");
    expect(result.length).toBeGreaterThan(5);
  });

  it("puts the start before the arrow and end after", () => {
    const result = fmtDateRange("2026-06-20T10:00:00.000Z", "2026-06-20T12:00:00.000Z");
    const [start, end] = result.split("→").map((s) => s.trim());
    // Both parts should be non-empty strings produced by toLocaleString
    expect(start).toBeTruthy();
    expect(end).toBeTruthy();
  });

  it("produces different strings for different date ranges", () => {
    const a = fmtDateRange("2026-06-20T10:00:00.000Z", "2026-06-20T12:00:00.000Z");
    const b = fmtDateRange("2026-06-21T10:00:00.000Z", "2026-06-21T12:00:00.000Z");
    expect(a).not.toBe(b);
  });
});
