import { describe, expect, it } from "vitest";
import {
  eventMeta,
  formatDuration,
  liveDurationSec,
  POLL_MS,
  pollIntervalForStatus,
  severityMeta,
} from "../lib/incidents";

describe("formatDuration", () => {
  it("handles null / negative", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
  it("formats across units", () => {
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(63)).toBe("1m 3s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3600 + 14 * 60)).toBe("1h 14m");
    expect(formatDuration(86_400)).toBe("1d");
    expect(formatDuration(86_400 + 3 * 3600)).toBe("1d 3h");
  });
});

describe("liveDurationSec", () => {
  const now = Date.parse("2026-06-20T01:00:00.000Z");
  it("uses the recorded duration when present", () => {
    expect(
      liveDurationSec(
        { startedAt: "2026-06-20T00:00:00.000Z", resolvedAt: null, durationSec: 120 },
        now,
      ),
    ).toBe(120);
  });
  it("computes elapsed time for an open incident", () => {
    expect(
      liveDurationSec(
        { startedAt: "2026-06-20T00:30:00.000Z", resolvedAt: null, durationSec: null },
        now,
      ),
    ).toBe(1800);
  });
  it("returns null for a bad start date", () => {
    expect(
      liveDurationSec({ startedAt: "nope", resolvedAt: null, durationSec: null }, now),
    ).toBeNull();
  });
});

describe("pollIntervalForStatus", () => {
  it("polls while open or acknowledged", () => {
    expect(pollIntervalForStatus("OPEN")).toBe(POLL_MS);
    expect(pollIntervalForStatus("ACKNOWLEDGED")).toBe(POLL_MS);
  });
  it("stops polling once resolved or unknown", () => {
    expect(pollIntervalForStatus("RESOLVED")).toBe(false);
    expect(pollIntervalForStatus(undefined)).toBe(false);
  });
});

describe("severityMeta", () => {
  it("maps known severities and falls back", () => {
    expect(severityMeta("CRITICAL")).toEqual({ label: "Critical", tone: "down" });
    expect(severityMeta("WARNING").tone).toBe("brand");
    expect(severityMeta("WAT")).toEqual({ label: "WAT", tone: "muted" });
  });
});

describe("eventMeta", () => {
  it("maps event types to label + icon", () => {
    expect(eventMeta("DETECTED")).toMatchObject({ icon: "alert", tone: "down" });
    expect(eventMeta("RESOLVED")).toMatchObject({ icon: "check", tone: "up" });
    expect(eventMeta("COMMENT").icon).toBe("message");
    expect(eventMeta("NOTIFICATION_SENT").icon).toBe("bell");
    expect(eventMeta("ESCALATED").icon).toBe("arrow-up");
  });
});
