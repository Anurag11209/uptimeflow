/**
 * One-shot backfill for `monitor_daily_stats`.
 *
 * The scheduled tick only recomputes recent days, so historical checks that
 * predate the rollup need a deliberate pass. This walks the range in chunks and
 * calls the same `rollupWindow` the scheduled job uses — one code path, so
 * backfilled rows and live rows are identical by construction.
 *
 * Chunking is what keeps this practical: a single statement over all history
 * risks one very long transaction, while a day-at-a-time loop re-scans
 * `check_results` once per day. A week per statement bounds both. The upsert is
 * idempotent, so an interrupted run is resumed by simply running it again.
 *
 *   pnpm --filter @backend-uptime/worker rollup:backfill \
 *     [--since=YYYY-MM-DD] [--until=YYYY-MM-DD] [--chunk-days=7]
 *
 * Defaults: `since` is the earliest check-result day, `until` is tomorrow (UTC).
 */
import { pino } from "pino";
import { createPrisma } from "@backend-uptime/db";
import { earliestCheckDay, rollupWindow, utcDayStart } from "@backend-uptime/monitoring";
import { parseEnv } from "./env.js";

const DAY_MS = 86_400_000;

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

/** Parse a `YYYY-MM-DD` CLI date into midnight UTC, or exit with a clear error. */
function parseDay(raw: string, flag: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    // eslint-disable-next-line no-console
    console.error(`--${flag} must be YYYY-MM-DD (got "${raw}").`);
    process.exit(1);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    // eslint-disable-next-line no-console
    console.error(`--${flag} is not a real date (got "${raw}").`);
    process.exit(1);
  }
  return parsed;
}

function parseChunkDays(): number {
  const raw = argValue("chunk-days");
  if (raw === undefined) return 7;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 365) {
    // eslint-disable-next-line no-console
    console.error(`--chunk-days must be an integer between 1 and 365 (got "${raw}").`);
    process.exit(1);
  }
  return n;
}

const env = parseEnv(process.env);
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: `${env.OTEL_SERVICE_NAME}-backfill` },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

const prisma = createPrisma({ databaseUrl: env.DATABASE_URL });

async function main(): Promise<void> {
  const chunkDays = parseChunkDays();
  const sinceArg = argValue("since");
  const untilArg = argValue("until");

  const since = sinceArg ? parseDay(sinceArg, "since") : await earliestCheckDay(prisma);
  if (!since) {
    logger.info({}, "no check results found — nothing to backfill");
    return;
  }
  // Exclusive upper bound: tomorrow, so today's partial row is included.
  const until = untilArg
    ? parseDay(untilArg, "until")
    : new Date(utcDayStart(new Date()).getTime() + DAY_MS);

  if (since >= until) {
    logger.error(
      { since: since.toISOString(), until: until.toISOString() },
      "--since must be before --until",
    );
    process.exitCode = 1;
    return;
  }

  const totalDays = Math.round((until.getTime() - since.getTime()) / DAY_MS);
  logger.info(
    { since: since.toISOString().slice(0, 10), until: until.toISOString().slice(0, 10), totalDays, chunkDays },
    "backfill starting",
  );

  const startedAll = Date.now();
  let cursor = since;
  let totalRows = 0;
  let chunks = 0;

  while (cursor < until) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + chunkDays * DAY_MS, until.getTime()));
    const started = Date.now();
    const rows = await rollupWindow(prisma, { from: cursor, to: chunkEnd });
    totalRows += rows;
    chunks++;
    logger.info(
      {
        from: cursor.toISOString().slice(0, 10),
        to: chunkEnd.toISOString().slice(0, 10),
        rows,
        elapsedMs: Date.now() - started,
      },
      "chunk complete",
    );
    cursor = chunkEnd;
  }

  logger.info({ chunks, totalRows, elapsedMs: Date.now() - startedAll }, "backfill complete");
}

main()
  .catch((err) => {
    logger.error({ err }, "backfill failed");
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
