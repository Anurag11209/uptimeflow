import type { Job } from "bullmq";
import type { IntegrationType, PrismaClient } from "@backend-uptime/db";
import { SlackNotifier, type DeliveryResult, type FetchLike, type IntegrationEvent } from "@backend-uptime/notifications";
import type { IntegrationJobData } from "./queue.js";

export interface IntegrationProcessorLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface IntegrationProcessorDeps {
  prisma: PrismaClient;
  logger?: IntegrationProcessorLogger;
  /** Injected in tests; defaults to global fetch via the notifiers. */
  fetchImpl?: FetchLike;
  /** Per-send timeout passed to the notifiers. */
  timeoutMs?: number;
}

export interface IntegrationProcessorResult {
  delivered: boolean;
  status: number;
  skipped?: boolean;
}

type SendOutcome = DeliveryResult & { skipped?: boolean };

/**
 * BullMQ processor for the integration delivery queue. For one job it marks the
 * delivery SENDING, loads the (still enabled) integration, renders + sends via
 * the provider notifier, and records the result. A disabled/deleted integration
 * is a terminal skip (no retry). A transient failure marks FAILED and throws so
 * BullMQ retries with backoff; the final attempt marks the row DEAD
 * (dead-letter) before throwing. Idempotent: jobId == deliveryId.
 */
export function createIntegrationProcessor(deps: IntegrationProcessorDeps) {
  const { prisma } = deps;

  async function send(
    type: IntegrationType,
    integrationId: string,
    organizationId: string,
    event: IntegrationEvent,
  ): Promise<SendOutcome> {
    switch (type) {
      case "SLACK": {
        // Enablement is enforced by the dispatcher (who fans out); the processor
        // just sends what was enqueued, so a `test` to a disabled integration
        // still validates its webhook. Deleted integrations are always skipped.
        const cfg = await prisma.slackIntegration.findFirst({
          where: { id: integrationId, organizationId, deletedAt: null },
          select: { webhookUrl: true },
        });
        if (!cfg) return { ok: false, status: 0, skipped: true, error: "integration not found or disabled" };
        return SlackNotifier.send(cfg.webhookUrl, event, { fetchImpl: deps.fetchImpl, timeoutMs: deps.timeoutMs });
      }
      default:
        return { ok: false, status: 0, skipped: true, error: `unsupported integration type: ${type}` };
    }
  }

  return async (job: Job<IntegrationJobData>): Promise<IntegrationProcessorResult> => {
    const { deliveryId, integrationType, integrationId, organizationId, event } = job.data;
    const attempt = job.attemptsMade + 1;
    const maxAttempts = job.opts.attempts ?? 1;

    await prisma.integrationDelivery.update({
      where: { id: deliveryId },
      data: { status: "SENDING", attempts: attempt },
    });

    const outcome = await send(integrationType, integrationId, organizationId, event);

    if (outcome.skipped) {
      await prisma.integrationDelivery.update({
        where: { id: deliveryId },
        data: { status: "FAILED", error: outcome.error ?? "skipped" },
      });
      deps.logger?.warn({ deliveryId, integrationType, reason: outcome.error }, "integration delivery skipped");
      return { delivered: false, status: 0, skipped: true };
    }

    if (outcome.ok) {
      await prisma.integrationDelivery.update({
        where: { id: deliveryId },
        data: { status: "SUCCESS", responseStatus: outcome.status, sentAt: new Date(), error: null },
      });
      deps.logger?.info({ deliveryId, integrationType, status: outcome.status }, "integration delivered");
      return { delivered: true, status: outcome.status };
    }

    const isFinal = attempt >= maxAttempts;
    await prisma.integrationDelivery.update({
      where: { id: deliveryId },
      data: {
        status: isFinal ? "DEAD" : "FAILED",
        responseStatus: outcome.status || null,
        error: outcome.error ?? "delivery failed",
      },
    });
    deps.logger?.error(
      { deliveryId, integrationType, attempt, maxAttempts, status: outcome.status, err: outcome.error },
      isFinal ? "integration delivery dead-lettered" : "integration delivery failed (will retry)",
    );
    // Throw so BullMQ applies its retry/backoff policy.
    throw new Error(`integration delivery failed (${integrationType} status=${outcome.status}): ${outcome.error}`);
  };
}
