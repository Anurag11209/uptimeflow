import type { Job } from "bullmq";
import { renderEmail } from "./email/templates.js";
import type { EmailJob, EmailSender } from "./types.js";

export interface ProcessorLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface EmailProcessorResult {
  template: string;
  providerMessageId: string | null;
}

/**
 * Pure job processor, injected into a BullMQ Worker by apps/worker and unit
 * tested in isolation. Throwing triggers BullMQ's retry/backoff policy.
 */
export function createEmailProcessor(deps: { sender: EmailSender; logger?: ProcessorLogger }) {
  return async (job: Job<EmailJob>): Promise<EmailProcessorResult> => {
    const rendered = renderEmail(job.data);
    try {
      const { providerMessageId } = await deps.sender.send({
        to: job.data.to,
        template: job.data.template,
        ...rendered,
      });
      deps.logger?.info(
        { jobId: job.id, template: job.data.template, providerMessageId },
        "email delivered",
      );
      return { template: job.data.template, providerMessageId };
    } catch (error) {
      deps.logger?.error(
        {
          jobId: job.id,
          template: job.data.template,
          attempt: job.attemptsMade + 1,
          error: error instanceof Error ? error.message : String(error),
        },
        "email delivery failed",
      );
      throw error;
    }
  };
}
