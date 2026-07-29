import { Prisma } from "@backend-uptime/db";
import type { PrismaClient } from "@backend-uptime/db";

/**
 * Daily rollup writer: folds the `check_results` firehose into one
 * `monitor_daily_stats` row per (monitor, region, day).
 *
 * Everything happens inside a single `INSERT … SELECT … ON CONFLICT DO UPDATE`
 * for three reasons:
 *   • it is the only way to get real percentiles — Prisma's `groupBy` cannot
 *     express `percentile_cont`, and pulling raw checks into the process to
 *     sort them in JS is exactly the firehose scan the read layer avoids;
 *   • one statement is atomic and idempotent, so re-running a window is a
 *     no-op-shaped overwrite rather than a duplicate insert;
 *   • the aggregation stays next to the data instead of crossing the wire.
 *
 * Granularity is always per-region (`region` non-NULL). The schema also allows
 * an all-region row (`region = NULL`) and the read layer can consume either,
 * but writing both shapes would double-count: `statusPage.getHistory` sums
 * every row for a (monitor, day) without filtering region. Per-region is the
 * shape that also powers the regional breakdown, and it is the only shape
 * `ON CONFLICT` can match — Postgres treats NULLs as distinct in a unique
 * index, so a NULL-region row would insert a duplicate instead of updating.
 */

/** Statuses counted as a successful observation (mirrors `isSuccess`). */
const UP_STATUSES = Prisma.sql`('UP','DEGRADED')`;
/** Statuses counted as a failed observation (mirrors `failedChecksToday`). */
const DOWN_STATUSES = Prisma.sql`('DOWN','TIMEOUT','ERROR')`;

/** Seconds in a day — downtime within one day cannot exceed it. */
const DAY_SEC = 86_400;

const DAY_MS = 86_400_000;

/** Midnight UTC on the day containing `d`. */
export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** `YYYY-MM-DD` in UTC — the form the SQL binds and casts to `date`. */
function dayParam(d: Date): string {
  return utcDayStart(d).toISOString().slice(0, 10);
}

export interface RollupWindow {
  /** Inclusive start. Floored to midnight UTC. */
  from: Date;
  /** Exclusive end. Floored to midnight UTC. */
  to: Date;
}

/**
 * Recompute every (monitor, region, day) row whose checks fall in
 * `[from, to)` and return the number of rows written.
 *
 * Boundaries are floored to midnight UTC because the upsert replaces a day's
 * row wholesale: a window covering only part of a day would compute stats from
 * a fraction of that day's checks and overwrite an already-complete row with
 * them. Whole-day windows make that impossible. (Today's row is legitimately
 * partial — the window is [today, tomorrow) and simply has no checks past the
 * current moment — and it is corrected by every later run.)
 *
 * `checkedAt` is `TIMESTAMP(3)` without a time zone holding UTC, so the day
 * bucket is a plain `::date` cast. Boundaries bind as `YYYY-MM-DD` strings cast
 * to `date` rather than as JS `Date` objects, so the comparison can't be
 * re-interpreted through the session's TimeZone setting.
 */
export async function rollupWindow(prisma: PrismaClient, window: RollupWindow): Promise<number> {
  const from = dayParam(window.from);
  const to = dayParam(window.to);
  if (from >= to) return 0;

  return prisma.$executeRaw`
    INSERT INTO monitor_daily_stats (
      id, "organizationId", "monitorId", region, day,
      "totalChecks", "upChecks", "downChecks", "uptimePct",
      "avgResponseMs", "p95ResponseMs", "p99ResponseMs", "downtimeSec"
    )
    SELECT
      gen_random_uuid(),
      cr."organizationId",
      cr."monitorId",
      cr.region,
      cr."checkedAt"::date,
      COUNT(*),
      COUNT(*) FILTER (WHERE cr.status IN ${UP_STATUSES}),
      COUNT(*) FILTER (WHERE cr.status IN ${DOWN_STATUSES}),
      ROUND(
        100.0 * COUNT(*) FILTER (WHERE cr.status IN ${UP_STATUSES}) / COUNT(*),
        4
      ),
      -- Latency covers successful checks only: a timeout records responseMs at
      -- the timeout ceiling, which is a deadline, not a response time.
      ROUND(AVG(cr."responseMs") FILTER (WHERE cr.status IN ${UP_STATUSES}))::int,
      (PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY cr."responseMs")
        FILTER (WHERE cr.status IN ${UP_STATUSES}))::int,
      (PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY cr."responseMs")
        FILTER (WHERE cr.status IN ${UP_STATUSES}))::int,
      LEAST(
        COUNT(*) FILTER (WHERE cr.status IN ${DOWN_STATUSES}) * m."intervalSeconds",
        ${DAY_SEC}::int
      )::int
    FROM check_results cr
    JOIN monitors m ON m.id = cr."monitorId"
    WHERE cr."checkedAt" >= ${from}::date
      AND cr."checkedAt" <  ${to}::date
    GROUP BY cr."organizationId", cr."monitorId", cr.region, cr."checkedAt"::date, m."intervalSeconds"
    ON CONFLICT ("monitorId", region, day) DO UPDATE SET
      "totalChecks"   = EXCLUDED."totalChecks",
      "upChecks"      = EXCLUDED."upChecks",
      "downChecks"    = EXCLUDED."downChecks",
      "uptimePct"     = EXCLUDED."uptimePct",
      "avgResponseMs" = EXCLUDED."avgResponseMs",
      "p95ResponseMs" = EXCLUDED."p95ResponseMs",
      "p99ResponseMs" = EXCLUDED."p99ResponseMs",
      "downtimeSec"   = EXCLUDED."downtimeSec"
  `;
}

export interface RollupRecentOptions {
  /** How many days before today to recompute alongside it. */
  lookbackDays: number;
  now?: Date;
}

/**
 * Recompute today plus the previous `lookbackDays` days.
 *
 * Recomputing rather than only closing yesterday is what makes the job
 * self-healing: late-arriving checks, worker downtime and clock skew all get
 * corrected on the next tick instead of leaving a permanent hole, and because
 * the upsert is idempotent, repeating the work costs a query and nothing else.
 * Including today means the dashboard shows partial current-day data rather
 * than a gap.
 */
export async function rollupRecentDays(
  prisma: PrismaClient,
  options: RollupRecentOptions,
): Promise<number> {
  const now = options.now ?? new Date();
  const lookback = Math.max(0, Math.trunc(options.lookbackDays));
  const today = utcDayStart(now);
  return rollupWindow(prisma, {
    from: new Date(today.getTime() - lookback * DAY_MS),
    to: new Date(today.getTime() + DAY_MS),
  });
}

/**
 * Earliest check-result day, or null when there are none. Used by the backfill
 * to pick a default start without the caller guessing how far back data goes.
 */
export async function earliestCheckDay(prisma: PrismaClient): Promise<Date | null> {
  const rows = await prisma.$queryRaw<{ day: Date | null }[]>`
    SELECT MIN("checkedAt")::date AS day FROM check_results
  `;
  const day = rows[0]?.day;
  return day ? utcDayStart(new Date(day)) : null;
}
