import { Prisma } from "@backend-uptime/db";
import type { IncidentSeverity, PrismaClient, ProbeRegion } from "@backend-uptime/db";

/**
 * Org-wide analytics, aggregated DB-side (groupBy/aggregate) so a dashboard
 * never scans the check-result firehose or loads daily rows into app memory —
 * important at 100k+ orgs. The pre-aggregated MonitorDailyStat rollup is the
 * primary source (uptime, p95, downtime); the live CheckResult table is only
 * touched for "today" counters that the daily rollup hasn't closed yet.
 *
 * Daily-stat granularity: the worker may store one row per (monitor, region,
 * day) OR a single all-region row (region = null) per (monitor, day). We detect
 * which exists per request and aggregate from that set so totals are never
 * double-counted, mirroring the assumption the status-page history already
 * relies on. Regional breakdowns require the per-region rows.
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

export function createAnalyticsService(deps: { prisma: PrismaClient }): AnalyticsService {
  const { prisma } = deps;

  /**
   * Decide which daily-stat granularity to aggregate from for this scope so
   * org-wide totals are never double-counted. Returns the `region` where-filter
   * to apply: per-region rows when they exist, else the all-region (null) rows.
   */
  async function granularityFilter(
    where: Prisma.MonitorDailyStatWhereInput,
  ): Promise<Prisma.EnumProbeRegionNullableFilter | null> {
    const perRegion = await prisma.monitorDailyStat.count({
      where: { ...where, region: { not: null } },
    });
    // `null` here means "all-region rollup row" (region IS NULL).
    return perRegion > 0 ? { not: null } : null;
  }

  function baseWhere(
    organizationId: string,
    range: AnalyticsRange,
    monitorId?: string,
  ): Prisma.MonitorDailyStatWhereInput {
    return {
      organizationId,
      day: { gte: range.since, lte: range.until },
      ...(monitorId ? { monitorId } : {}),
    };
  }

  /** Org-wide (or per-monitor) rolled-up totals across the range. */
  async function totals(where: Prisma.MonitorDailyStatWhereInput) {
    const region = await granularityFilter(where);
    const scoped: Prisma.MonitorDailyStatWhereInput = { ...where, region };
    const agg = await prisma.monitorDailyStat.aggregate({
      where: scoped,
      _sum: { upChecks: true, totalChecks: true, downChecks: true, downtimeSec: true },
      _avg: { avgResponseMs: true },
      _max: { p95ResponseMs: true },
    });
    return {
      scoped,
      upChecks: agg._sum.upChecks ?? 0,
      totalChecks: agg._sum.totalChecks ?? 0,
      downChecks: agg._sum.downChecks ?? 0,
      downtimeSec: agg._sum.downtimeSec ?? 0,
      avgResponseMs: agg._avg.avgResponseMs !== null ? Math.round(agg._avg.avgResponseMs) : null,
      p95ResponseMs: agg._max.p95ResponseMs ?? null,
    };
  }

  async function dailySeries(
    scoped: Prisma.MonitorDailyStatWhereInput,
    range: AnalyticsRange,
  ): Promise<DailyPoint[]> {
    const grouped = await prisma.monitorDailyStat.groupBy({
      by: ["day"],
      where: scoped,
      _sum: { upChecks: true, totalChecks: true, downChecks: true },
      _avg: { avgResponseMs: true },
    });
    const byDay = new Map(grouped.map((g) => [dayKey(g.day), g]));

    // Emit a continuous series so charts have no gaps for quiet days.
    const points: DailyPoint[] = [];
    for (let i = 0; i < range.days; i++) {
      const key = dayKey(new Date(startOfUtcDay(range.since).getTime() + i * DAY_MS));
      const g = byDay.get(key);
      const total = g?._sum.totalChecks ?? 0;
      const up = g?._sum.upChecks ?? 0;
      points.push({
        day: key,
        uptimePct: pct(up, total),
        avgResponseMs:
          g && g._avg.avgResponseMs !== null ? Math.round(g._avg.avgResponseMs) : null,
        totalChecks: total,
        failedChecks: g?._sum.downChecks ?? 0,
      });
    }
    return points;
  }

  async function regionStats(
    where: Prisma.MonitorDailyStatWhereInput,
  ): Promise<RegionStat[]> {
    const regionWhere: Prisma.MonitorDailyStatWhereInput = { ...where, region: { not: null } };
    const [grouped, outages] = await Promise.all([
      prisma.monitorDailyStat.groupBy({
        by: ["region"],
        where: regionWhere,
        _sum: { upChecks: true, totalChecks: true, downChecks: true },
        _avg: { avgResponseMs: true },
      }),
      prisma.monitorDailyStat.groupBy({
        by: ["region"],
        where: { ...regionWhere, downChecks: { gt: 0 } },
        _max: { day: true },
      }),
    ]);
    const lastOutage = new Map(outages.map((o) => [o.region, o._max.day]));

    return grouped
      .filter((g): g is typeof g & { region: ProbeRegion } => g.region !== null)
      .map((g) => {
        const total = g._sum.totalChecks ?? 0;
        const up = g._sum.upChecks ?? 0;
        const lastDay = lastOutage.get(g.region);
        return {
          region: g.region,
          avgResponseMs: g._avg.avgResponseMs !== null ? Math.round(g._avg.avgResponseMs) : null,
          successRatePct: pct(up, total),
          failedChecks: g._sum.downChecks ?? 0,
          totalChecks: total,
          lastOutageAt: lastDay ? dayKey(lastDay) : null,
        };
      })
      .sort((a, b) => ALL_REGIONS.indexOf(a.region) - ALL_REGIONS.indexOf(b.region));
  }

  return {
    async summary(organizationId, range) {
      const where = baseWhere(organizationId, range);
      const startToday = startOfUtcDay(range.until);
      const [t, totalMonitors, activeMonitors, activeIncidents, rangeIncidents, failedToday] =
        await Promise.all([
          totals(where),
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
      const operationalSec = Math.max(0, range.days * 86_400 - t.downtimeSec);
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
      const where = baseWhere(organizationId, range);
      const region = await granularityFilter(where);
      const points = await dailySeries({ ...where, region }, range);
      return { rangeDays: range.days, points };
    },

    async regions(organizationId, range) {
      const regions = await regionStats(baseWhere(organizationId, range));
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
      const where = baseWhere(organizationId, range);
      const region = await granularityFilter(where);
      const scoped: Prisma.MonitorDailyStatWhereInput = { ...where, region };

      const [perMonitor, incidentsByMonitor, t, resolvedAgg, totalIncidents] = await Promise.all([
        prisma.monitorDailyStat.groupBy({
          by: ["monitorId"],
          where: scoped,
          _sum: { upChecks: true, totalChecks: true, downtimeSec: true },
        }),
        prisma.incident.groupBy({
          by: ["monitorId"],
          where: {
            organizationId,
            startedAt: { gte: range.since, lte: range.until },
            monitorId: { not: null },
          },
          _count: { _all: true },
        }),
        totals(where),
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

      const ids = perMonitor.map((m) => m.monitorId);
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
          monitorId: m.monitorId,
          name: nameById.get(m.monitorId) ?? "(deleted monitor)",
          uptimePct: pct(m._sum.upChecks ?? 0, m._sum.totalChecks ?? 0),
          downtimeSec: m._sum.downtimeSec ?? 0,
          incidents: incidentsById.get(m.monitorId) ?? 0,
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

      const where = baseWhere(organizationId, range, monitorId);
      const t = await totals(where);
      const [daily, regions] = await Promise.all([
        dailySeries(t.scoped, range),
        regionStats(where),
      ]);

      return {
        rangeDays: range.days,
        uptimePct: pct(t.upChecks, t.totalChecks),
        avgResponseMs: t.avgResponseMs,
        p95ResponseMs: t.p95ResponseMs,
        downtimeSec: t.downtimeSec,
        daily,
        regions,
      };
    },
  };
}
