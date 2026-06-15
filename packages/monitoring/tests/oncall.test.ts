import { describe, expect, it } from "vitest";
import { resolveOnCall, rotationIndex, tzOffsetMs, type ScheduleForResolve } from "../src/index.js";

function schedule(over: Partial<ScheduleForResolve> = {}): ScheduleForResolve {
  return {
    timezone: "UTC",
    rotationType: "WEEKLY",
    handoffMinute: 540,
    participants: [
      { userId: "u1", position: 0 },
      { userId: "u2", position: 1 },
    ],
    overrides: [],
    ...over,
  };
}

describe("tzOffsetMs", () => {
  it("is 0 for UTC and -4h for US east coast in summer (EDT)", () => {
    const d = new Date("2026-06-15T12:00:00Z");
    expect(tzOffsetMs(d, "UTC")).toBe(0);
    expect(tzOffsetMs(d, "America/New_York")).toBe(-4 * 3_600_000);
  });

  it("falls back to 0 for an unknown timezone", () => {
    expect(tzOffsetMs(new Date(), "Not/AZone")).toBe(0);
  });
});

describe("resolveOnCall — rotation", () => {
  it("returns a primary and a distinct secondary", () => {
    const r = resolveOnCall(schedule(), new Date("2026-06-15T12:00:00Z"));
    expect(r.source).toBe("rotation");
    expect(r.primaryUserId).not.toBeNull();
    expect(r.secondaryUserId).not.toBe(r.primaryUserId);
  });

  it("hands off to the next participant after one weekly period", () => {
    const t0 = new Date("2026-06-15T12:00:00Z");
    const t1 = new Date(t0.getTime() + 7 * 86_400_000);
    const a = resolveOnCall(schedule(), t0).primaryUserId;
    const b = resolveOnCall(schedule(), t1).primaryUserId;
    expect(a).not.toBe(b);
  });

  it("is empty with no participants and no override", () => {
    const r = resolveOnCall(schedule({ participants: [] }), new Date());
    expect(r).toMatchObject({ source: "empty", primaryUserId: null, secondaryUserId: null });
  });
});

describe("resolveOnCall — overrides", () => {
  const now = new Date("2026-06-15T12:00:00Z");

  it("an active override becomes the primary responder", () => {
    const r = resolveOnCall(
      schedule({
        overrides: [{ userId: "u9", startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 3_600_000) }],
      }),
      now,
    );
    expect(r.source).toBe("override");
    expect(r.primaryUserId).toBe("u9");
    expect(r.secondaryUserId).not.toBeNull(); // rotation still provides a backup
  });

  it("ignores an expired override", () => {
    const r = resolveOnCall(
      schedule({
        overrides: [{ userId: "u9", startsAt: new Date(now.getTime() - 7_200_000), endsAt: new Date(now.getTime() - 3_600_000) }],
      }),
      now,
    );
    expect(r.source).toBe("rotation");
  });
});

describe("rotationIndex", () => {
  it("is stable within a period and advances across it", () => {
    const s = schedule({
      rotationType: "DAILY",
      participants: [
        { userId: "a", position: 0 },
        { userId: "b", position: 1 },
        { userId: "c", position: 2 },
      ],
    });
    const t = new Date("2026-06-15T12:00:00Z");
    const i0 = rotationIndex(s, t);
    const i1 = rotationIndex(s, new Date(t.getTime() + 86_400_000));
    expect(i1).toBe((i0 + 1) % 3);
  });
});
