import { describe, expect, it } from "vitest";
import { formatDelay, formatRepeat, stepLabel } from "../lib/escalation-policies";

describe("formatDelay", () => {
  it("returns 'Immediately' for 0 minutes", () => {
    expect(formatDelay(0)).toBe("Immediately");
  });

  it("formats minutes under an hour", () => {
    expect(formatDelay(5)).toBe("5m");
    expect(formatDelay(30)).toBe("30m");
    expect(formatDelay(59)).toBe("59m");
  });

  it("formats exact hours", () => {
    expect(formatDelay(60)).toBe("1h");
    expect(formatDelay(120)).toBe("2h");
    expect(formatDelay(240)).toBe("4h");
  });

  it("formats hours and remaining minutes", () => {
    expect(formatDelay(65)).toBe("1h 5m");
    expect(formatDelay(90)).toBe("1h 30m");
    expect(formatDelay(125)).toBe("2h 5m");
  });
});

describe("formatRepeat", () => {
  it("returns 'No repeat' for 0", () => {
    expect(formatRepeat(0)).toBe("No repeat");
  });

  it("returns 'Repeat once' for 1", () => {
    expect(formatRepeat(1)).toBe("Repeat once");
  });

  it("formats higher counts with x", () => {
    expect(formatRepeat(2)).toBe("Repeat 2x");
    expect(formatRepeat(5)).toBe("Repeat 5x");
    expect(formatRepeat(10)).toBe("Repeat 10x");
  });
});

describe("stepLabel", () => {
  it("uses ordinal words for first 10 positions", () => {
    expect(stepLabel(0)).toBe("1st escalation");
    expect(stepLabel(1)).toBe("2nd escalation");
    expect(stepLabel(2)).toBe("3rd escalation");
    expect(stepLabel(3)).toBe("4th escalation");
    expect(stepLabel(9)).toBe("10th escalation");
  });

  it("falls back to numeric for positions beyond the ordinals array", () => {
    expect(stepLabel(10)).toBe("11th escalation");
    expect(stepLabel(19)).toBe("20th escalation");
  });
});
