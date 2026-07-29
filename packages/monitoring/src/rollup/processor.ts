import type { Job } from "bullmq";
import type { PrismaClient } from "@backend-uptime/db";
import { rollupRecentDays } from "./aggregate.js";
import { ROLLUP_JOB_NAME, type RollupJobData } from "./queue.js";

export interface RollupLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface RollupProcessorDeps {
  prisma: PrismaClient;
  logger?: RollupLogger;
}

export interface RollupJobResult {
  rows: number;
  lookbackDays: number;
  durationMs: number;
}

/**
 * Processes one rollup tick. Errors are allowed to propagate so BullMQ owns the
 * retry — there is no partial state to unwind, since the aggregation is a single
 * idempotent statement.
 */
export function createRollupProcessor(deps: RollupProcessorDeps) {
  return async (job: Job<RollupJobData>): Promise<RollupJobResult> => {
    const lookbackDays = job.data.lookbackDays;
    const started = Date.now();
    const rows = await rollupRecentDays(deps.prisma, { lookbackDays });
    const durationMs = Date.now() - started;
    deps.logger?.info({ rows, lookbackDays, durationMs }, "daily stats rolled up");
    return { rows, lookbackDays, durationMs };
  };
}

/** Stable id so every replica converges on one schedule instead of N. */
export const ROLLUP_SCHEDULER_ID = "rollup:daily-stats";

/** Structural subset of a BullMQ Queue the scheduler needs (keeps it testable). */
export interface RollupSchedulableQueue {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeat: { every: number },
    template: { name: string; data: RollupJobData },
  ): Promise<unknown>;
}

export interface RollupSchedulerDeps {
  queue: RollupSchedulableQueue;
  /** Tick cadence in ms. */
  intervalMs: number;
  /** Days before today to recompute on each tick. */
  lookbackDays: number;
  logger?: RollupLogger;
}

/**
 * Registers the repeatable rollup tick.
 *
 * BullMQ deduplicates job schedulers by id, so calling this from every worker
 * replica still yields one schedule and therefore one job per tick — the same
 * single-execution property `createScheduler` relies on, and the reason this is
 * queue-driven rather than a bare `setInterval` in each process.
 */
export function createRollupScheduler(deps: RollupSchedulerDeps) {
  return {
    async ensure(): Promise<void> {
      await deps.queue.upsertJobScheduler(
        ROLLUP_SCHEDULER_ID,
        { every: deps.intervalMs },
        { name: ROLLUP_JOB_NAME, data: { lookbackDays: deps.lookbackDays } },
      );
      deps.logger?.info(
        { intervalMs: deps.intervalMs, lookbackDays: deps.lookbackDays },
        "rollup scheduler registered",
      );
    },
  };
}

export type RollupScheduler = ReturnType<typeof createRollupScheduler>;
