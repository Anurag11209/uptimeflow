import { Prisma } from "@backend-uptime/db";
import type { IncidentSeverity, PrismaClient, ProbeRegion } from "@backend-uptime/db";

/**
 * Org-wide analytics, aggregated DB-side (groupBy/aggregate) so a dashboard
 * never scans the check-result firehose or loads daily rows into app memory —
 * important at 100k+ orgs. The pre-aggregated MonitorDailyStat rollup is the
 * primary source (uptime, p95, downtime); the live CheckResult table is only
 * touched for "today" counters that the daily rollup hasn't closed yet.
 *
 * Daily-stat granularity: the rollup writer emits one row per (monitor, region,
 * day), but the schema also permits a single all-region row (region = null) per
 * (monitor, day). We detect which exists per request and aggregate from that
 * set so totals are never double-counted, mirroring the assumption the
 * status-page history already relies on. Regional breakdowns require the
 * per-region rows.
 *
 * Aggregates that combine rows are computed in SQL rather than with Prisma's
 * `_avg`/`_sum` helpers, for two reasons that Prisma cannot express:
 *   • latency must be *check-weighted* — a region-day with 10 checks cannot
 *     weigh the same as one with 10,000, which is what averaging daily
 *     averages does;
 *   • downtime must be collapsed across regions per (monitor, day) before
 *     summing — a monitor probed from N regions writes N rows describing the
 *     same wall-clock outage, so a flat SUM reports N× the real downtime.
 */

// ───────────────────────────── Range ────────────────────────────────────────

export interface AnalyticsRange {
  /** Inclusive lower bound (UTC midnight, days-1 before today). */
  since: Date;
  /** Now. */
  until: Date;
  days: number;
}

const DAY_MS = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Build a day-aligned range ending now and spanning `days` days. */
export function rangeForDays(days: number, now = new Date()): AnalyticsRange {
  const since = new Date(startOfUtcDay(now).getTime() - (days - 1) * DAY_MS);
  return { since, until: now, days };
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ───────────────────────────── View types ───────────────────────────────────

export interface AnalyticsSummary {
  rangeDays: number;
  overallUptimePct: number | null;
  slaCompliancePct: number | null;
  activeMonitors: number;
  totalMonitors: number;
  activeIncidents: number;
  incidentsInRange: number;
  mttrSec: number | null;
  mtbfSec: number | null;
  avgResponseMs: number | null;
  failedChecksToday: number;
  totalChecks: number;
  downtimeSec: number;
}

export interface DailyPoint {
  day: string;
  uptimePct: number | null;
  avgResponseMs: number | null;
  totalChecks: number;
  failedChecks: number;
}

export interface AnalyticsTimeseries {
  rangeDays: number;
  points: DailyPoint[];
}

export interface RegionStat {
  region: ProbeRegion;
  avgResponseMs: number | null;
  successRatePct: number | null;
  failedChecks: number;
  totalChecks: number;
  /** Most recent day with at least one failed check, or null. */
  lastOutageAt: string | null;
}

export interface RegionalAnalytics {
  rangeDays: number;
  regions: RegionStat[];
}

export interface SeverityCount {
  severity: IncidentSeverity;
  count: number;
}

export interface CauseCount {
  cause: string;
  count: number;
}

export interface MonthlyIncidentPoint {
  month: string; // YYYY-MM
  count: number;
  avgDurationSec: number | null;
}

export interface IncidentAnalytics {
  rangeDays: number;
  total: number;
  avgDurationSec: number | null;
  bySeverity: SeverityCount[];
  byCause: CauseCount[];
  monthly: MonthlyIncidentPoint[];
  longest: { id: string; title: string; durationSec: number | null; startedAt: Date }[];
}

export interface SlaMonitorRow {
  monitorId: string;
  name: string;
  uptimePct: number | null;
  downtimeSec: number;
  incidents: number;
}

export interface SlaReport {
  rangeDays: number;
  slaPct: number | null;
  downtimeSec: number;
  totalIncidents: number;
  avgRecoverySec: number | null;
  monitors: SlaMonitorRow[];
}

export interface MonitorAnalytics {
  rangeDays: number;
  uptimePct: number | null;
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
  downtimeSec: number;
  daily: DailyPoint[];
  regions: RegionStat[];
}

// ───────────────────────────── Service ──────────────────────────────────────

const ALL_REGIONS: ProbeRegion[] = [
  "NA_EAST",
  "NA_WEST",
  "EU_WEST",
  "EU_CENTRAL",
  "AP_SOUTHEAST",
  "AP_NORTHEAST",
  "SA_EAST",
  "AF_SOUTH",
];

export interface AnalyticsService {
  summary(organizationId: string, range: AnalyticsRange): Promise<AnalyticsSummary>;
  timeseries(organizationId: string, range: AnalyticsRange): Promise<AnalyticsTimeseries>;
  regions(organizationId: string, range: AnalyticsRange): Promise<RegionalAnalytics>;
  incidents(organizationId: string, range: AnalyticsRange): Promise<IncidentAnalytics>;
  sla(organizationId: string, range: AnalyticsRange): Promise<SlaReport>;
  monitor(
    organizationId: string,
    monitorId: string,
    range: AnalyticsRange,
  ): Promise<MonitorAnalytics | null>;
}

function pct(up: number, total: number): number | null {
  return total > 0 ? round2((up / total) * 100) : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `SUM(int)` comes back from Postgres as int8, which Prisma maps to BigInt. */
function num(value: bigint | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

/** Nullable numeric column: preserve "no data" rather than collapsing it to 0. */
function intOrNull(value: bigint | number | null | undefined): number | null {
  return value == null ? null : Number(value);
}

/** A `date` column arrives as a Date or a `YYYY-MM-DD` string depending on driver. */
function toDayKey(value: Date | string): string {
  return typeof value === "string" ? value.slice(0, 10) : dayKey(value);
}

export function createAnalyticsService(deps: { prisma: PrismaClient }): AnalyticsService {
  const { prisma } = deps;

  /** A resolved read scope: what to aggregate, and from which granularity. */
  interface StatScope {
    organizationId: string;
    since: Date;
    until: Date;
    monitorId?: string;
    /** true → read `region IS NOT NULL` rows; false → the all-region rows. */
    perRegion: boolean;
  }

  function rawScope(
    organizationId: string,
    range: AnalyticsRange,
    perRegion: boolean,
    monitorId?: string,
  ): StatScope {
    return { organizationId, since: range.since, until: range.until, monitorId, perRegion };
  }

  /** WHERE fragment shared by every raw daily-stat aggregate. */
  function scopeSql(scope: StatScope): Prisma.Sql {
    return Prisma.sql`
      "organizationId" = ${scope.organizationId}
      AND day >= ${dayKey(scope.since)}::date
      AND day <= ${dayKey(scope.until)}::date
      ${scope.monitorId ? Prisma.sql`AND "monitorId" = ${scope.monitorId}::uuid` : Prisma.empty}
      AND region IS ${scope.perRegion ? Prisma.sql`NOT NULL` : Prisma.sql`NULL`}
    `;
  }

  /**
   * Decide which daily-stat granularity to aggregate from for this scope so
   * org-wide totals are never double-counted. Per-region wins when present: it
   * is what the rollup writer emits, and the only shape that can support a
   * regional breakdown.
   */
  async function resolveScope(
    organizationId: string,
    range: AnalyticsRange,
    monitorId?: string,
  ): Promise<StatScope> {
    const perRegion = await prisma.monitorDailyStat.count({
      where: {
        organizationId,
        day: { gte: range.since, lte: range.until },
        ...(monitorId ? { monitorId } : {}),
        region: { not: null },
      },
    });
    return rawScope(organizationId, range, perRegion > 0, monitorId);
  }

  interface TotalsRow {
    total_checks: bigint | number;
    up_checks: bigint | number;
    down_checks: bigint | number;
    avg_response_ms: number | null;
    downtime_sec: bigint | number;
  }

  /**
   * Org-wide (or per-monitor) rolled-up totals across the range, in one query:
   * check-weighted latency, and downtime collapsed across regions per
   * (monitor, day) before summing so a multi-region monitor's outage is counted
   * once rather than once per region.
   */
  async function totals(scope: StatScope) {
    const rows = await prisma.$queryRaw<TotalsRow[]>`
      WITH scoped AS (
        SELECT "monitorId", day, "totalChecks", "upChecks", "downChecks",
               "avgResponseMs", "downtimeSec"
        FROM monitor_daily_stats
        WHERE ${scopeSql(scope)}
      ),
      per_monitor_day AS (
        SELECT AVG("downtimeSec") AS downtime FROM scoped GROUP BY "monitorId", day
      )
      SELECT
        COALESCE((SELECT SUM("totalChecks") FROM scoped), 0)::bigint AS total_checks,
        COALESCE((SELECT SUM("upChecks") FROM scoped), 0)::bigint    AS up_checks,
        COALESCE((SELECT SUM("downChecks") FROM scoped), 0)::bigint  AS down_checks,
        (SELECT ROUND(
                  SUM("avgResponseMs"::numeric * "totalChecks")
                  / NULLIF(SUM("totalChecks") FILTER (WHERE "avgResponseMs" IS NOT NULL), 0)
                )::int FROM scoped) AS avg_response_ms,
        COALESCE((SELECT ROUND(SUM(downtime)) FROM per_monitor_day), 0)::bigint AS downtime_sec
    `;
    const row = rows[0];
    return {
      upChecks: num(row?.up_checks),
      totalChecks: num(row?.total_checks),
      downChecks: num(row?.down_checks),
      downtimeSec: num(row?.downtime_sec),
      avgResponseMs: intOrNull(row?.avg_response_ms),
    };
  }

  interface DailyRow {
    day: Date | string;
    total_checks: bigint | number;
    up_checks: bigint | number;
    down_checks: bigint | number;
    avg_response_ms: number | null;
  }

  async function dailySeries(scope: StatScope, range: AnalyticsRange): Promise<DailyPoint[]> {
    const rows = await prisma.$queryRaw<DailyRow[]>`
      SELECT
        day,
        SUM("totalChecks")::bigint AS total_checks,
        SUM("upChecks")::bigint    AS up_checks,
        SUM("downChecks")::bigint  AS down_checks,
        ROUND(
          SUM("avgResponseMs"::numeric * "totalChecks")
          / NULLIF(SUM("totalChecks") FILTER (WHERE "avgResponseMs" IS NOT NULL), 0)
        )::int AS avg_response_ms
      FROM monitor_daily_stats
      WHERE ${scopeSql(scope)}
      GROUP BY day
    `;
    const byDay = new Map(rows.map((r) => [toDayKey(r.day), r]));

    // Emit a continuous series so charts have no gaps for quiet days.
    const points: DailyPoint[] = [];
    for (let i = 0; i < range.days; i++) {
      const key = dayKey(new Date(startOfUtcDay(range.since).getTime() + i * DAY_MS));
      const r = byDay.get(key);
      const total = num(r?.total_checks);
      points.push({
        day: key,
        uptimePct: pct(num(r?.up_checks), total),
        avgResponseMs: intOrNull(r?.avg_response_ms),
        totalChecks: total,
        failedChecks: num(r?.down_checks),
      });
    }
    return points;
  }

  interface RegionRow {
    region: ProbeRegion;
    total_checks: bigint | number;
    up_checks: bigint | number;
    down_checks: bigint | number;
    avg_response_ms: number | null;
    last_outage: Date | string | null;
  }

  async function regionStats(scope: StatScope): Promise<RegionStat[]> {
    // A regional breakdown only exists in per-region rows, whatever granularity
    // the rest of the request resolved to. `FILTER` folds what used to be a
    // second grouped query for the last-outage day into this one.
    const rows = await prisma.$queryRaw<RegionRow[]>`
      SELECT
        region,
        SUM("totalChecks")::bigint AS total_checks,
        SUM("upChecks")::bigint    AS up_checks,
        SUM("downChecks")::bigint  AS down_checks,
        ROUND(
          SUM("avgResponseMs"::numeric * "totalChecks")
          / NULLIF(SUM("totalChecks") FILTER (WHERE "avgResponseMs" IS NOT NULL), 0)
        )::int AS avg_response_ms,
        MAX(day) FILTER (WHERE "downChecks" > 0) AS last_outage
      FROM monitor_daily_stats
      WHERE ${scopeSql({ ...scope, perRegion: true })}
      GROUP BY region
    `;

    return rows
      .map((r) => {
        const total = num(r.total_checks);
        return {
          region: r.region,
          avgResponseMs: intOrNull(r.avg_response_ms),
          successRatePct: pct(num(r.up_checks), total),
          failedChecks: num(r.down_checks),
          totalChecks: total,
          lastOutageAt: r.last_outage ? toDayKey(r.last_outage) : null,
        };
      })
      .sort((a, b) => ALL_REGIONS.indexOf(a.region) - ALL_REGIONS.indexOf(b.region));
  }

  interface PerMonitorRow {
    monitor_id: string;
    up_checks: bigint | number;
    total_checks: bigint | number;
    downtime_sec: bigint | number;
  }

  /**
   * Exact p95 latency over the range, from raw checks.
   *
   * A range percentile is not recoverable from daily percentiles — the max of
   * per-day p95s is not a p95 of the range — so this is a deliberate, bounded
   * exception to reading only the rollup: a single monitor over an indexed
   * `(monitorId, checkedAt)` range, on a page the web app already caches.
   * Successful checks only, matching how the rollup stores latency.
   *
   * Scoped by monitor alone: the caller has already verified org ownership, and
   * adding a redundant org predicate would only push the planner off the more
   * selective index.
   */
  async function exactP95(monitorId: string, range: AnalyticsRange): Promise<number | null> {
    const rows = await prisma.$queryRaw<{ p95: number | null }[]>`
      SELECT (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "responseMs"))::int AS p95
      FROM check_results
      WHERE "monitorId" = ${monitorId}::uuid
        AND "checkedAt" >= ${dayKey(range.since)}::date
        AND "checkedAt" <  ${dayKey(range.until)}::date + 1
        AND status IN ('UP','DEGRADED')
    `;
    return intOrNull(rows[0]?.p95);
  }

  /** Per-monitor SLA rows, with downtime collapsed across regions as in `totals`. */
  async function perMonitorTotals(scope: StatScope): Promise<PerMonitorRow[]> {
    return prisma.$queryRaw<PerMonitorRow[]>`
      WITH scoped AS (
        SELECT "monitorId", day, "totalChecks", "upChecks", "downtimeSec"
        FROM monitor_daily_stats
        WHERE ${scopeSql(scope)}
      ),
      per_monitor_day AS (
        SELECT "monitorId", day, AVG("downtimeSec") AS downtime
        FROM scoped GROUP BY "monitorId", day
      )
      SELECT
        s."monitorId" AS monitor_id,
        SUM(s."upChecks")::bigint    AS up_checks,
        SUM(s."totalChecks")::bigint AS total_checks,
        COALESCE((
          SELECT ROUND(SUM(d.downtime)) FROM per_monitor_day d
          WHERE d."monitorId" = s."monitorId"
        ), 0)::bigint AS downtime_sec
      FROM scoped s
      GROUP BY s."monitorId"
    `;
  }

  return {
    async summary(organizationId, range) {
      const scope = await resolveScope(organizationId, range);
      const startToday = startOfUtcDay(range.until);
      const [t, totalMonitors, activeMonitors, activeIncidents, rangeIncidents, failedToday] =
        await Promise.all([
          totals(scope),
          prisma.monitor.count({ where: { organizationId, deletedAt: null } }),
          prisma.monitor.count({ where: { organizationId, deletedAt: null, state: "ACTIVE" } }),
          prisma.incident.count({
            where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          }),
          prisma.incident.aggregate({
            where: { organizationId, startedAt: { gte: range.since, lte: range.until } },
            _count: { _all: true },
          }),
          prisma.checkResult.count({
            where: {
              organizationId,
              checkedAt: { gte: startToday },
              status: { in: ["DOWN", "TIMEOUT", "ERROR"] },
            },
          }),
        ]);

      // MTTR: mean recovery time of incidents resolved within the range.
      const mttrAgg = await prisma.incident.aggregate({
        where: {
          organizationId,
          resolvedAt: { gte: range.since, lte: range.until },
          durationSec: { not: null },
        },
        _avg: { durationSec: true },
      });

      const incidentsInRange = rangeIncidents._count._all;
      const uptimePct = pct(t.upChecks, t.totalChecks);
      // MTBF ≈ total operational time / number of failures over the window.
      // Operational time is per-monitor time summed over the fleet: the
      // incident count is org-wide, so dividing it into a single monitor's
      // worth of wall-clock understates MTBF by roughly the monitor count.
      const operationalSec = Math.max(0, activeMonitors * range.days * 86_400 - t.downtimeSec);
      const mtbfSec = incidentsInRange > 0 ? Math.round(operationalSec / incidentsInRange) : null;

      return {
        rangeDays: range.days,
        overallUptimePct: uptimePct,
        slaCompliancePct: uptimePct,
        activeMonitors,
        totalMonitors,
        activeIncidents,
        incidentsInRange,
        mttrSec: mttrAgg._avg.durationSec !== null ? Math.round(mttrAgg._avg.durationSec) : null,
        mtbfSec,
        avgResponseMs: t.avgResponseMs,
        failedChecksToday: failedToday,
        totalChecks: t.totalChecks,
        downtimeSec: t.downtimeSec,
      };
    },

    async timeseries(organizationId, range) {
      const scope = await resolveScope(organizationId, range);
      const points = await dailySeries(scope, range);
      return { rangeDays: range.days, points };
    },

    async regions(organizationId, range) {
      // Always per-region, so the granularity probe would be wasted work.
      const regions = await regionStats(rawScope(organizationId, range, true));
      return { rangeDays: range.days, regions };
    },

    async incidents(organizationId, range) {
      const where: Prisma.IncidentWhereInput = {
        organizationId,
        startedAt: { gte: range.since, lte: range.until },
      };
      const [bySeverityRaw, durationAgg, rows] = await Promise.all([
        prisma.incident.groupBy({ by: ["severity"], where, _count: { _all: true } }),
        prisma.incident.aggregate({
          where: { ...where, durationSec: { not: null } },
          _avg: { durationSec: true },
        }),
        prisma.incident.findMany({
          where,
          select: { id: true, title: true, cause: true, severity: true, startedAt: true, durationSec: true },
          orderBy: { startedAt: "asc" },
        }),
      ]);

      const bySeverity: SeverityCount[] = bySeverityRaw.map((s) => ({
        severity: s.severity,
        count: s._count._all,
      }));

      // Cause + monthly buckets in JS — incident counts are modest vs the
      // check firehose, and grouping a nullable text column DB-side is awkward.
      const causeMap = new Map<string, number>();
      const monthMap = new Map<string, { count: number; durSum: number; durN: number }>();
      for (const r of rows) {
        const cause = r.cause?.trim() || "Unknown";
        causeMap.set(cause, (causeMap.get(cause) ?? 0) + 1);
        const month = dayKey(r.startedAt).slice(0, 7);
        const m = monthMap.get(month) ?? { count: 0, durSum: 0, durN: 0 };
        m.count += 1;
        if (r.durationSec !== null) {
          m.durSum += r.durationSec;
          m.durN += 1;
        }
        monthMap.set(month, m);
      }

      const byCause: CauseCount[] = [...causeMap.entries()]
        .map(([cause, count]) => ({ cause, count }))
        .sort((a, b) => b.count - a.count);
      const monthly: MonthlyIncidentPoint[] = [...monthMap.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, m]) => ({
          month,
          count: m.count,
          avgDurationSec: m.durN > 0 ? Math.round(m.durSum / m.durN) : null,
        }));
      const longest = [...rows]
        .filter((r) => r.durationSec !== null)
        .sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))
        .slice(0, 5)
        .map((r) => ({ id: r.id, title: r.title, durationSec: r.durationSec, startedAt: r.startedAt }));

      return {
        rangeDays: range.days,
        total: rows.length,
        avgDurationSec:
          durationAgg._avg.durationSec !== null ? Math.round(durationAgg._avg.durationSec) : null,
        bySeverity,
        byCause,
        monthly,
        longest,
      };
    },

    async sla(organizationId, range) {
      const scope = await resolveScope(organizationId, range);

      const [perMonitor, incidentsByMonitor, t, resolvedAgg, totalIncidents] = await Promise.all([
        perMonitorTotals(scope),
        prisma.incident.groupBy({
          by: ["monitorId"],
          where: {
            organizationId,
            startedAt: { gte: range.since, lte: range.until },
            monitorId: { not: null },
          },
          _count: { _all: true },
        }),
        totals(scope),
        prisma.incident.aggregate({
          where: {
            organizationId,
            resolvedAt: { gte: range.since, lte: range.until },
            durationSec: { not: null },
          },
          _avg: { durationSec: true },
        }),
        prisma.incident.count({
          where: { organizationId, startedAt: { gte: range.since, lte: range.until } },
        }),
      ]);

      const ids = perMonitor.map((m) => m.monitor_id);
      const names = ids.length
        ? await prisma.monitor.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const nameById = new Map(names.map((n) => [n.id, n.name]));
      const incidentsById = new Map(
        incidentsByMonitor
          .filter((i): i is typeof i & { monitorId: string } => i.monitorId !== null)
          .map((i) => [i.monitorId, i._count._all]),
      );

      const monitors: SlaMonitorRow[] = perMonitor
        .map((m) => ({
          monitorId: m.monitor_id,
          name: nameById.get(m.monitor_id) ?? "(deleted monitor)",
          uptimePct: pct(num(m.up_checks), num(m.total_checks)),
          downtimeSec: num(m.downtime_sec),
          incidents: incidentsById.get(m.monitor_id) ?? 0,
        }))
        .sort((a, b) => (a.uptimePct ?? 101) - (b.uptimePct ?? 101));

      return {
        rangeDays: range.days,
        slaPct: pct(t.upChecks, t.totalChecks),
        downtimeSec: t.downtimeSec,
        totalIncidents,
        avgRecoverySec:
          resolvedAgg._avg.durationSec !== null ? Math.round(resolvedAgg._avg.durationSec) : null,
        monitors,
      };
    },

    async monitor(organizationId, monitorId, range) {
      const exists = await prisma.monitor.findFirst({
        where: { id: monitorId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return null;

      const scope = await resolveScope(organizationId, range, monitorId);
      const [t, daily, regions, p95ResponseMs] = await Promise.all([
        totals(scope),
        dailySeries(scope, range),
        regionStats(scope),
        exactP95(monitorId, range),
      ]);

      return {
        rangeDays: range.days,
        uptimePct: pct(t.upChecks, t.totalChecks),
        avgResponseMs: t.avgResponseMs,
        p95ResponseMs,
        downtimeSec: t.downtimeSec,
        daily,
        regions,
      };
    },
  };
}
