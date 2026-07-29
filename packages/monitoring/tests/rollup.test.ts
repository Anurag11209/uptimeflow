import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import {
  ROLLUP_JOB_NAME,
  ROLLUP_SCHEDULER_ID,
  createRollupProcessor,
  createRollupScheduler,
  earliestCheckDay,
  rollupRecentDays,
  rollupWindow,
  utcDayStart,
  type RollupJobData,
  type RollupSchedulableQueue,
} from "../src/index.js";

/**
 * `$executeRaw`/`$queryRaw` are tagged templates, so a stub receives
 * (strings, ...values). Interpolated `Prisma.Sql` fragments land in `values`
 * alongside the bound parameters; the window boundaries are the only
 * `YYYY-MM-DD` strings among them, which is what these assertions key on.
 */
function mockPrisma(options: { rows?: number; earliest?: unknown; fail?: Error } = {}) {
  const executions: Array<{ sql: string; days: string[] }> = [];
  const prisma = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      if (options.fail) throw options.fail;
      executions.push({
        sql: strings.join(" ? "),
        days: values.filter((v): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)),
      });
      return options.rows ?? 0;
    },
    $queryRaw: async () => [{ day: options.earliest ?? null }],
  } as unknown as PrismaClient;
  return { prisma, executions };
}

function fakeQueue() {
  const upserts: Array<{ id: string; every: number; name: string; data: RollupJobData }> = [];
  const queue: RollupSchedulableQueue = {
    upsertJobScheduler: async (id, repeat, template) => {
      upserts.push({ id, every: repeat.every, name: template.name, data: template.data });
    },
  };
  return { queue, upserts };
}

/** BullMQ passes the whole Job; the processor only reads `data`. */
const job = (data: RollupJobData) => ({ data }) as Parameters<ReturnType<typeof createRollupProcessor>>[0];

describe("rollupWindow", () => {
  it("aggregates a half-open [from, to) window of whole UTC days", async () => {
    const { prisma, executions } = mockPrisma({ rows: 4 });
    const rows = await rollupWindow(prisma, {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-08T00:00:00.000Z"),
    });

    expect(rows).toBe(4);
    expect(executions).toHaveLength(1);
    expect(executions[0].days).toEqual(["2026-07-01", "2026-07-08"]);
  });

  it("floors both boundaries to midnight UTC so a day's row is never built from part of a day", async () => {
    const { prisma, executions } = mockPrisma();
    await rollupWindow(prisma, {
      from: new Date("2026-07-01T17:45:12.000Z"),
      to: new Date("2026-07-03T09:30:00.000Z"),
    });

    expect(executions[0].days).toEqual(["2026-07-01", "2026-07-03"]);
  });

  it("writes per-region rows and upserts on the (monitorId, region, day) key", async () => {
    const { prisma, executions } = mockPrisma();
    await rollupWindow(prisma, {
      from: new Date("2026-07-01T00:00:00.000Z"),
      to: new Date("2026-07-02T00:00:00.000Z"),
    });

    const { sql } = executions[0];
    expect(sql).toContain(`ON CONFLICT ("monitorId", region, day) DO UPDATE`);
    // region comes straight from the check row, never NULL — a NULL-region row
    // could not be matched by ON CONFLICT and would duplicate instead of update.
    expect(sql).toContain("cr.region");
    expect(sql).toContain("PERCENTILE_CONT(0.95)");
    expect(sql).toContain("PERCENTILE_CONT(0.99)");
  });

  it("does no work for an empty or inverted window", async () => {
    const { prisma, executions } = mockPrisma();
    const same = new Date("2026-07-01T00:00:00.000Z");
    expect(await rollupWindow(prisma, { from: same, to: same })).toBe(0);
    expect(
      await rollupWindow(prisma, { from: new Date("2026-07-09T00:00:00.000Z"), to: same }),
    ).toBe(0);
    expect(executions).toHaveLength(0);
  });
});

describe("rollupRecentDays", () => {
  it("covers today plus the lookback, ending at tomorrow", async () => {
    const { prisma, executions } = mockPrisma();
    await rollupRecentDays(prisma, { lookbackDays: 2, now: new Date("2026-07-29T13:05:00.000Z") });

    expect(executions[0].days).toEqual(["2026-07-27", "2026-07-30"]);
  });

  it("still recomputes today when lookback is zero", async () => {
    const { prisma, executions } = mockPrisma();
    await rollupRecentDays(prisma, { lookbackDays: 0, now: new Date("2026-07-29T00:00:01.000Z") });

    expect(executions[0].days).toEqual(["2026-07-29", "2026-07-30"]);
  });

  it("crosses a month boundary without arithmetic drift", async () => {
    const { prisma, executions } = mockPrisma();
    await rollupRecentDays(prisma, { lookbackDays: 3, now: new Date("2026-08-01T06:00:00.000Z") });

    expect(executions[0].days).toEqual(["2026-07-29", "2026-08-02"]);
  });
});

describe("earliestCheckDay", () => {
  it("returns null when there are no checks to backfill", async () => {
    const { prisma } = mockPrisma({ earliest: null });
    expect(await earliestCheckDay(prisma)).toBeNull();
  });

  it("normalises the earliest check to midnight UTC", async () => {
    const { prisma } = mockPrisma({ earliest: new Date("2026-03-14T21:09:00.000Z") });
    expect(await earliestCheckDay(prisma)).toEqual(new Date("2026-03-14T00:00:00.000Z"));
  });
});

describe("rollup processor", () => {
  it("rolls up the job's lookback window and reports what it wrote", async () => {
    const { prisma, executions } = mockPrisma({ rows: 12 });
    const process = createRollupProcessor({ prisma });

    const result = await process(job({ lookbackDays: 1 }));

    expect(result).toMatchObject({ rows: 12, lookbackDays: 1 });
    expect(executions).toHaveLength(1);
  });

  it("propagates failures so BullMQ owns the retry", async () => {
    const { prisma } = mockPrisma({ fail: new Error("deadlock detected") });
    const process = createRollupProcessor({ prisma });

    await expect(process(job({ lookbackDays: 2 }))).rejects.toThrow("deadlock detected");
  });
});

describe("rollup scheduler", () => {
  it("registers one repeatable tick under a stable id", async () => {
    const { queue, upserts } = fakeQueue();
    await createRollupScheduler({ queue, intervalMs: 900_000, lookbackDays: 2 }).ensure();

    expect(upserts).toEqual([
      {
        id: ROLLUP_SCHEDULER_ID,
        every: 900_000,
        name: ROLLUP_JOB_NAME,
        data: { lookbackDays: 2 },
      },
    ]);
  });

  it("uses the same id across replicas, so N workers converge on one schedule", async () => {
    const { queue, upserts } = fakeQueue();
    const scheduler = createRollupScheduler({ queue, intervalMs: 60_000, lookbackDays: 0 });
    await scheduler.ensure();
    await scheduler.ensure();

    expect(new Set(upserts.map((u) => u.id)).size).toBe(1);
  });
});

describe("utcDayStart", () => {
  it("truncates to midnight UTC regardless of the local zone", () => {
    expect(utcDayStart(new Date("2026-07-29T23:59:59.999Z"))).toEqual(
      new Date("2026-07-29T00:00:00.000Z"),
    );
  });
});
