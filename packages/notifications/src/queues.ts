import { Queue, type JobsOptions } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";
import type { EmailJob } from "./types.js";

export const QUEUE_NAMES = { email: "emails" } as const;

/**
 * BullMQ requires maxRetriesPerRequest: null on its connections.
 * Each service should create ONE connection for queues and dedicated
 * connections per Worker (BullMQ duplicates internally for blocking ops).
 */
export function createQueueConnection(redisUrl: string, options: RedisOptions = {}): Redis {
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    ...options,
  });
}

export type EmailQueue = Queue<EmailJob>;

export function createEmailQueue(connection: Redis): EmailQueue {
  return new Queue<EmailJob>(QUEUE_NAMES.email, {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 3_600 },
    },
  });
}

/** Enqueue a transactional email; job name doubles as the template name. */
export async function enqueueEmail(
  queue: EmailQueue,
  job: EmailJob,
  options: JobsOptions = {},
): Promise<string> {
  const added = await queue.add(job.template, job, options);
  return added.id ?? "unknown";
}
