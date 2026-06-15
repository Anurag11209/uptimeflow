import { Queue } from "bullmq";
import type { Redis } from "ioredis";

export const ESCALATION_QUEUE_NAME = "monitor-escalations";
export const ESCALATION_JOB_NAME = "escalate";

/** One escalation tick: fire `stepIndex` of `policyId` for an incident. */
export interface EscalationJobData {
  incidentId: string;
  organizationId: string;
  monitorId: string | null;
  policyId: string;
  stepIndex: number;
  /** Which pass through the policy (0-based), bounded by policy.repeatCount. */
  round: number;
}

export type EscalationQueue = Queue<EscalationJobData>;

export function createEscalationQueue(connection: Redis): EscalationQueue {
  return new Queue<EscalationJobData>(ESCALATION_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: { age: 24 * 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });
}
