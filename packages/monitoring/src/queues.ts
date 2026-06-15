import { Queue } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import type { ProbeRegion } from "@backend-uptime/db";
import type { CheckJobData } from "./types.js";

export const MONITOR_CHECK_QUEUE_PREFIX = "monitor-checks";
export const CHECK_JOB_NAME = "check";

/** Every region in the probe network (mirrors the ProbeRegion enum). */
export const PROBE_REGIONS = [
  "NA_EAST",
  "NA_WEST",
  "EU_WEST",
  "EU_CENTRAL",
  "AP_SOUTHEAST",
  "AP_NORTHEAST",
  "SA_EAST",
  "AF_SOUTH",
] as const satisfies readonly ProbeRegion[];

export const DEFAULT_REGION: ProbeRegion = "NA_EAST";

/**
 * One queue per region (`monitor-checks:<REGION>`). Regional workers consume
 * only their own queue, so the same scheduler/worker code runs unchanged
 * whether one process serves all regions (dev) or a process per region (the
 * Phase 3 monitoring-agent).
 */
export function checkQueueName(region: ProbeRegion): string {
  return `${MONITOR_CHECK_QUEUE_PREFIX}:${region}`;
}

/** BullMQ requires `maxRetriesPerRequest: null` on its connections. */
export function createQueueConnection(redisUrl: string, options: RedisOptions = {}): Redis {
  return new Redis(redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true, ...options });
}

export type CheckQueue = Queue<CheckJobData>;

export function createCheckQueue(connection: Redis, region: ProbeRegion): CheckQueue {
  return new Queue<CheckJobData>(checkQueueName(region), {
    connection,
    defaultJobOptions: {
      // The processor owns check-level retries (per monitor.retries); job-level
      // attempts cover only infra hiccups. Results live in Postgres, so prune
      // the queue aggressively.
      attempts: 2,
      backoff: { type: "fixed", delay: 2_000 },
      removeOnComplete: { age: 600, count: 1_000 },
      removeOnFail: { age: 3_600, count: 1_000 },
    },
  });
}

/** Build a region→queue map for the regions a deployment serves. */
export function createCheckQueues(
  connection: Redis,
  regions: readonly ProbeRegion[],
): Map<ProbeRegion, CheckQueue> {
  return new Map(regions.map((region) => [region, createCheckQueue(connection, region)]));
}
