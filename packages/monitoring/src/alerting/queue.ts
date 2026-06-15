import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const ALERT_QUEUE_NAME = "monitor-alerts";
export const ALERT_JOB_NAME = "deliver";

export type AlertKind = "opened" | "resolved";

/** One notification delivery to dispatch (a single channel for one incident). */
export interface AlertJobData {
  deliveryId: string;
  incidentId: string;
  channelId: string;
  organizationId: string;
  kind: AlertKind;
}

export type AlertQueue = Queue<AlertJobData>;

export function createAlertQueue(connection: Redis): AlertQueue {
  return new Queue<AlertJobData>(ALERT_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // Real send retries with backoff; the delivery row tracks attempts/state.
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });
}
