import type { PrismaClient } from "@backend-uptime/db";
import { enqueueEmail, type EmailJob, type EmailQueue } from "@backend-uptime/notifications";
import type { Logger } from "../telemetry.js";
import type { StatusNotifier } from "./status-page.service.js";

const PHASE_TEMPLATE: Record<
  "opened" | "updated" | "resolved",
  "status_incident_opened" | "status_incident_updated" | "status_incident_resolved"
> = {
  opened: "status_incident_opened",
  updated: "status_incident_updated",
  resolved: "status_incident_resolved",
};

/**
 * Concrete StatusNotifier: turns subscriber/incident events into jobs on the
 * shared email queue, which the worker delivers via SES with the existing
 * retry/backoff policy (queue-based + retry). Per-recipient jobs carry a
 * deterministic jobId so a retried request or duplicate update never sends the
 * same email twice (idempotent). Best-effort: a notification failure is logged
 * but never propagated, so it cannot fail the originating API request.
 */
export function createStatusNotifier(deps: {
  prisma: PrismaClient;
  emailQueue: EmailQueue;
  webUrl: string;
  logger: Logger;
}): StatusNotifier {
  const { prisma, emailQueue, logger } = deps;
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return {
    async sendVerification({ pageName, email, confirmUrl }) {
      try {
        const job: EmailJob = { template: "status_subscribe_confirm", to: email, pageName, confirmUrl };
        // Idempotent on the confirm token embedded in the URL.
        const jobId = `status-confirm:${confirmUrl.split("token=")[1] ?? email}`;
        await enqueueEmail(emailQueue, job, { jobId });
      } catch (err) {
        logger.error({ err, email }, "status verification email enqueue failed");
      }
    },

    async notifyIncident(input) {
      try {
        const subscribers = await prisma.statusPageSubscriber.findMany({
          where: { statusPageId: input.statusPageId, status: "ACTIVE", unsubscribeToken: { not: null } },
          select: { id: true, email: true, unsubscribeToken: true },
        });
        if (subscribers.length === 0) return;

        const template = PHASE_TEMPLATE[input.phase];
        const publicUrl = `${webUrl}/status/${input.pageSlug}`;

        const results = await Promise.allSettled(
          subscribers.map((sub) => {
            const job: EmailJob = {
              template,
              to: sub.email,
              pageName: input.pageName,
              incidentTitle: input.title,
              statusLabel: input.statusLabel,
              body: input.body,
              publicUrl,
              unsubscribeUrl: `${publicUrl}/unsubscribe?token=${sub.unsubscribeToken}`,
            };
            // One job per (update, subscriber): replays/duplicates collapse.
            const jobId = `status-incident:${input.phase}:${input.incidentId}:${input.updateId}:${sub.id}`;
            return enqueueEmail(emailQueue, job, { jobId });
          }),
        );

        const failed = results.filter((r) => r.status === "rejected").length;
        logger.info(
          {
            statusPageId: input.statusPageId,
            incidentId: input.incidentId,
            phase: input.phase,
            recipients: subscribers.length,
            enqueued: subscribers.length - failed,
            failed,
          },
          "status incident subscribers notified",
        );
      } catch (err) {
        logger.error(
          { err, statusPageId: input.statusPageId, incidentId: input.incidentId },
          "status incident notification failed",
        );
      }
    },
  };
}
