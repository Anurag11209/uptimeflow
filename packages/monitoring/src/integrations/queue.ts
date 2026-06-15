import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { IntegrationType } from "@backend-uptime/db";
import type { IntegrationEvent } from "@backend-uptime/notifications";

export const INTEGRATION_QUEUE_NAME = "integration-deliveries";
export const INTEGRATION_JOB_NAME = "deliver";

/** One outbound delivery: a rendered event for a single integration target. */
export interface IntegrationJobData {
  deliveryId: string;
  integrationType: IntegrationType;
  integrationId: string;
  organizationId: string;
  /** Provider-agnostic event the processor renders per provider at send time. */
  event: IntegrationEvent;
}

export type IntegrationQueue = Queue<IntegrationJobData>;

export function createIntegrationQueue(connection: Redis): IntegrationQueue {
  return new Queue<IntegrationJobData>(INTEGRATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      // Exponential backoff with a bounded retry budget; the delivery row tracks
      // attempts/state and the processor dead-letters on the final failure.
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      // Keep failed jobs a week as a dead-letter trail.
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });
}
