import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const ROLLUP_QUEUE_NAME = "monitor-rollup";
export const ROLLUP_JOB_NAME = "rollup";

/** One rollup tick: recompute today plus `lookbackDays` previous days. */
export interface RollupJobData {
  lookbackDays: number;
}

export type RollupQueue = Queue<RollupJobData>;

export function createRollupQueue(connection: Redis): RollupQueue {
  return new Queue<RollupJobData>(ROLLUP_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // A failed tick is not urgent — the next one recomputes the same window —
      // but a transient DB blip shouldn't skip a cycle either.
      attempts: 3,
      backoff: { type: "exponential", delay: 30_000 },
      removeOnComplete: { age: 24 * 3_600, count: 100 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });
}
