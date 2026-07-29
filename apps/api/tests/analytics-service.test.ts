import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import { createAnalyticsService, rangeForDays } from "../src/services/analytics.service.js";

/**
 * The corrected aggregates are expressed in SQL, so these tests cover the two
 * things that are verifiable without a live Postgres:
 *
 *   • the SQL says what it must say — the check-weighting and the
 *     per-(monitor, day) downtime collapse *are* the fixes, and a revert to
 *     Prisma's `_avg`/`_sum` would silently reintroduce the bugs;
 *   • rows are mapped correctly — `SUM(int)` returns int8, which arrives as a
 *     BigInt and breaks arithmetic if handled naively, while a genuinely absent
 *     value must stay `null` rather than collapse to 0.
 *
 * The arithmetic itself is Postgres's, and is exercised by the end-to-end run
 * against a real database.
 */

const ORG = "org_1";

interface StubOptions {
  perRegionCount?: number;
  totals?: Record<string, unknown>[];
  daily?: Record<string, unknown>[];
  regions?: Record<string, unknown>[];
  perMonitor?: Record<string, unknown>[];
  p95?: Record<string, unknown>[];
  activeMonitors?: number;
  incidentsInRange?: number;
}

function stubPrisma(options: StubOptions = {}) {
  const sql: string[] = [];

  // `$queryRaw` is a tagged template: dispatch on the literal text so each
  // aggregate can be given its own canned rows.
  const queryRaw = async (strings: TemplateStringsArray): Promise<unknown[]> => {
    const text = strings.join(" ? ");
    sql.push(text);
    if (text.includes("AS monitor_id")) return options.perMonitor ?? [];
    if (text.includes("FROM check_results")) return options.p95 ?? [{ p95: null }];
    if (text.includes("GROUP BY day")) return options.daily ?? [];
    if (text.includes("GROUP BY region")) return options.regions ?? [];
    if (text.includes("AS total_checks")) return options.totals ?? [{}];
    return [];
  };

  const prisma = {
    $queryRaw: queryRaw,
    monitorDailyStat: { count: async () => options.perRegionCount ?? 1 },
    monitor: {
      count: async () => options.activeMonitors ?? 0,
      findFirst: async () => ({ id: "mon_1" }),
      findMany: async () => [{ id: "mon_1", name: "API" }],
    },
    incident: {
      count: async () => options.incidentsInRange ?? 0,
      aggregate: async () => ({
        _count: { _all: options.incidentsInRange ?? 0 },
        _avg: { durationSec: null },
      }),
      groupBy: async () => [],
    },
    checkResult: { count: async () => 0 },
  } as unknown as PrismaClient;

  return { prisma, sql, service: createAnalyticsService({ prisma }) };
}

/** Find the one query that produced a given aggregate. */
const find = (sql: string[], needle: string): string => sql.find((s) => s.includes(needle)) ?? "";

describe("analytics aggregation SQL", () => {
  it("weights latency by check count instead of averaging daily averages", async () => {
    const { service, sql } = stubPrisma();
    await service.summary(ORG, rangeForDays(30));

    const totals = find(sql, "AS total_checks");
    expect(totals).toContain(`SUM("avgResponseMs"::numeric * "totalChecks")`);
    // Days with no latency must not deflate the denominator.
    expect(totals).toContain(`FILTER (WHERE "avgResponseMs" IS NOT NULL)`);
  });

  it("collapses downtime across regions per (monitor, day) before summing", async () => {
    const { service, sql } = stubPrisma();
    await service.summary(ORG, rangeForDays(30));

    const totals = find(sql, "AS total_checks");
    // A monitor probed from N regions writes N rows for one wall-clock outage.
    expect(totals).toContain(`AVG("downtimeSec")`);
    expect(totals).toContain(`GROUP BY "monitorId", day`);
    expect(totals).not.toContain(`SUM("downtimeSec")`);
  });

  it("weights latency the same way in the daily series and the regional breakdown", async () => {
    const { service, sql } = stubPrisma();
    await service.timeseries(ORG, rangeForDays(7));
    await service.regions(ORG, rangeForDays(7));

    expect(find(sql, "GROUP BY day")).toContain(`SUM("avgResponseMs"::numeric * "totalChecks")`);
    expect(find(sql, "GROUP BY region")).toContain(`SUM("avgResponseMs"::numeric * "totalChecks")`);
  });

  it("computes a real percentile for a monitor rather than a max of daily p95s", async () => {
    const { service, sql } = stubPrisma({ p95: [{ p95: 415 }] });
    const result = await service.monitor(ORG, "mon_1", rangeForDays(30));

    const p95Query = find(sql, "FROM check_results");
    expect(p95Query).toContain("PERCENTILE_CONT(0.95)");
    expect(p95Query).toContain(`status IN ('UP','DEGRADED')`);
    expect(result?.p95ResponseMs).toBe(415);
  });
});

describe("analytics row mapping", () => {
  it("converts int8 sums from BigInt to number", async () => {
    const { service } = stubPrisma({
      totals: [
        {
          total_checks: 43_200n,
          up_checks: 43_190n,
          down_checks: 10n,
          avg_response_ms: 231,
          downtime_sec: 600n,
        },
      ],
    });

    const summary = await service.summary(ORG, rangeForDays(30));
    expect(summary.totalChecks).toBe(43_200);
    expect(summary.downtimeSec).toBe(600);
    expect(summary.avgResponseMs).toBe(231);
    expect(summary.overallUptimePct).toBe(99.98);
  });

  it("round-trips a perfect 100% day", async () => {
    const { service } = stubPrisma({
      totals: [
        {
          total_checks: 1_440n,
          up_checks: 1_440n,
          down_checks: 0n,
          avg_response_ms: 180,
          downtime_sec: 0n,
        },
      ],
    });

    const summary = await service.summary(ORG, rangeForDays(1));
    expect(summary.overallUptimePct).toBe(100);
    expect(summary.slaCompliancePct).toBe(100);
  });

  it("reports no data as null rather than zero", async () => {
    const { service } = stubPrisma({ totals: [{}] });
    const summary = await service.summary(ORG, rangeForDays(30));

    expect(summary.overallUptimePct).toBeNull();
    expect(summary.avgResponseMs).toBeNull();
    expect(summary.totalChecks).toBe(0);
  });

  it("emits a gap-free daily series, with nulls on days that have no checks", async () => {
    const { service } = stubPrisma({
      daily: [
        {
          day: "2026-07-28",
          total_checks: 1_440n,
          up_checks: 1_430n,
          down_checks: 10n,
          avg_response_ms: 210,
        },
      ],
    });

    const range = rangeForDays(3, new Date("2026-07-29T12:00:00.000Z"));
    const { points } = await service.timeseries(ORG, range);

    expect(points.map((p) => p.day)).toEqual(["2026-07-27", "2026-07-28", "2026-07-29"]);
    expect(points[1]).toMatchObject({ totalChecks: 1_440, failedChecks: 10, avgResponseMs: 210 });
    expect(points[0]).toMatchObject({ totalChecks: 0, uptimePct: null, avgResponseMs: null });
  });

  it("maps regional rows, including the last-outage day folded in via FILTER", async () => {
    const { service } = stubPrisma({
      regions: [
        {
          region: "EU_WEST",
          total_checks: 100n,
          up_checks: 99n,
          down_checks: 1n,
          avg_response_ms: 320,
          last_outage: "2026-07-20",
        },
        {
          region: "NA_EAST",
          total_checks: 100n,
          up_checks: 100n,
          down_checks: 0n,
          avg_response_ms: 120,
          last_outage: null,
        },
      ],
    });

    const { regions } = await service.regions(ORG, rangeForDays(30));
    // Sorted into probe-network order, not the order rows came back in.
    expect(regions.map((r) => r.region)).toEqual(["NA_EAST", "EU_WEST"]);
    expect(regions[1]).toMatchObject({ successRatePct: 99, lastOutageAt: "2026-07-20" });
    expect(regions[0].lastOutageAt).toBeNull();
  });

  it("maps per-monitor SLA rows and names them", async () => {
    const { service } = stubPrisma({
      perMonitor: [
        { monitor_id: "mon_1", up_checks: 990n, total_checks: 1_000n, downtime_sec: 600n },
      ],
    });

    const report = await service.sla(ORG, rangeForDays(30));
    expect(report.monitors).toEqual([
      { monitorId: "mon_1", name: "API", uptimePct: 99, downtimeSec: 600, incidents: 0 },
    ]);
  });
});

describe("MTBF", () => {
  it("scales operational time by the active monitor count", async () => {
    const { service } = stubPrisma({
      activeMonitors: 10,
      incidentsInRange: 2,
      totals: [{ total_checks: 100n, up_checks: 100n, down_checks: 0n, downtime_sec: 0n }],
    });

    const summary = await service.summary(ORG, rangeForDays(30));
    // 10 monitors × 30 days × 86400s / 2 incidents.
    expect(summary.mtbfSec).toBe((10 * 30 * 86_400) / 2);
  });

  it("is null with no incidents to divide by", async () => {
    const { service } = stubPrisma({ activeMonitors: 3, incidentsInRange: 0 });
    expect((await service.summary(ORG, rangeForDays(30))).mtbfSec).toBeNull();
  });

  it("never goes negative when recorded downtime exceeds the window", async () => {
    const { service } = stubPrisma({
      activeMonitors: 1,
      incidentsInRange: 1,
      totals: [{ total_checks: 10n, up_checks: 0n, down_checks: 10n, downtime_sec: 99_999_999n }],
    });

    expect((await service.summary(ORG, rangeForDays(1))).mtbfSec).toBe(0);
  });
});
