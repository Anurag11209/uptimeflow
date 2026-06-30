import { describe, expect, it } from "vitest";
import {
  displayName,
  formatHandoffTime,
  formatRotationType,
  onCallSourceLabel,
  parseHandoffTime,
  type OnCallUser,
  type RotationType,
} from "../lib/oncall-schedules";

describe("formatRotationType", () => {
  it("formats every rotation type", () => {
    const cases: [RotationType, string][] = [
      ["DAILY", "Daily"],
      ["WEEKLY", "Weekly"],
      ["BIWEEKLY", "Every 2 weeks"],
      ["CUSTOM", "Custom"],
    ];
    for (const [type, label] of cases) {
      expect(formatRotationType(type)).toBe(label);
    }
  });
});

describe("formatHandoffTime", () => {
  it("formats midnight as 00:00", () => {
    expect(formatHandoffTime(0)).toBe("00:00");
  });

  it("formats exact hours", () => {
    expect(formatHandoffTime(60)).toBe("01:00");
    expect(formatHandoffTime(540)).toBe("09:00");
  });

  it("formats hours with minutes, zero-padded", () => {
    expect(formatHandoffTime(545)).toBe("09:05");
    expect(formatHandoffTime(90)).toBe("01:30");
  });

  it("formats the last valid minute of the day", () => {
    expect(formatHandoffTime(1439)).toBe("23:59");
  });
});

describe("parseHandoffTime", () => {
  it("parses 00:00 as 0", () => {
    expect(parseHandoffTime("00:00")).toBe(0);
  });

  it("parses HH:MM into total minutes", () => {
    expect(parseHandoffTime("09:00")).toBe(540);
    expect(parseHandoffTime("09:05")).toBe(545);
    expect(parseHandoffTime("23:59")).toBe(1439);
  });

  it("round-trips with formatHandoffTime", () => {
    for (const minutes of [0, 60, 90, 540, 545, 1439]) {
      expect(parseHandoffTime(formatHandoffTime(minutes))).toBe(minutes);
    }
  });

  it("clamps out-of-range values", () => {
    expect(parseHandoffTime("25:00")).toBe(1439);
  });
});

describe("onCallSourceLabel", () => {
  it("labels each source", () => {
    expect(onCallSourceLabel("override")).toBe("Override active");
    expect(onCallSourceLabel("rotation")).toBe("On rotation");
    expect(onCallSourceLabel("empty")).toBe("No one on call");
  });
});

describe("displayName", () => {
  it("returns an em dash for null user", () => {
    expect(displayName(null)).toBe("—");
  });

  it("prefers name over email", () => {
    const user: OnCallUser = { userId: "u1", name: "Jane Doe", email: "jane@example.com" };
    expect(displayName(user)).toBe("Jane Doe");
  });

  it("falls back to email when name is null", () => {
    const user: OnCallUser = { userId: "u1", name: null, email: "jane@example.com" };
    expect(displayName(user)).toBe("jane@example.com");
  });

  it("falls back to userId when both name and email are null", () => {
    const user: OnCallUser = { userId: "u1", name: null, email: null };
    expect(displayName(user)).toBe("u1");
  });
});
