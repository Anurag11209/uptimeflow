import { enqueueEmail, type EmailJob, type EmailQueue } from "@backend-uptime/notifications";
import type { ResponderNotifier } from "@backend-uptime/monitoring";

/**
 * Pages an escalation responder by email, through the shared transactional
 * queue — the same route `status-notifier` uses to mail someone who has no
 * alert channel, and therefore the same real SMTP/SES delivery with the
 * existing retry/backoff.
 *
 * A USER or SCHEDULE target resolves to a person rather than an AlertChannel,
 * and `NotificationDelivery.channelId` is non-null, so there is no row shape
 * for a channel-less page. Routing through the email queue pages humans without
 * a migration; first-class per-user delivery rows are a follow-up, and can be
 * added later without changing how the page is sent.
 */
export function emailResponderNotifier(deps: { queue: EmailQueue; webUrl: string }): ResponderNotifier {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return {
    async page(n) {
      const job: EmailJob = {
        template: "incident",
        to: n.email,
        incidentTitle: n.incidentTitle,
        severity: n.severity ?? "unknown",
        description:
          n.summary ??
          `${n.monitorName ?? "A monitor"} is down. You are on the escalation path for this incident.`,
        // Must match the Next.js route (apps/web/app/dashboard/incidents/[id]).
        statusPageUrl: `${webUrl}/dashboard/incidents/${n.incidentId}`,
      };

      // One page per (incident, step, user). The escalation queue retries a
      // failed job up to 3 times, and a step pages several people at once — so
      // without a deterministic id, a retry triggered by one bad address would
      // re-mail everyone the step already reached.
      const jobId = `escalation-page:${n.incidentId}:${n.step}:${n.userId}`;
      await enqueueEmail(deps.queue, job, { jobId });
    },
  };
}
