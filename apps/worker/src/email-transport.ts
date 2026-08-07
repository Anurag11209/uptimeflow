import { renderEmail, type EmailSender } from "@backend-uptime/notifications";
import type { AlertTransport } from "@backend-uptime/monitoring";

/**
 * EMAIL alert-channel transport.
 *
 * Sends through the same `EmailSender` the transactional email worker uses, not
 * through the SES-or-logging `EmailProvider`. That distinction is the whole
 * point: `createEmailProvider` only knows `ses | logging`, so anything other
 * than `EMAIL_PROVIDER=ses` fell back to the logging provider, which returns a
 * synthetic message id — and the alert processor recorded that as a real
 * DELIVERED send with a "notification sent" timeline entry. Same phantom
 * success the transport fallback used to produce, one layer down.
 *
 * `createEmailSender` has no logging branch at all (`ses | resend | smtp`), so
 * routing through it makes a fake success unreachable in every environment
 * rather than merely refusing it in production. SMTP is a legitimate production
 * provider and now genuinely delivers here; a misconfigured one surfaces as a
 * real connection error, which the processor records as FAILED.
 *
 * Lives in its own module rather than inline in index.ts so it can be tested
 * without importing the entrypoint, which starts every queue worker on import.
 */
export function emailAlertTransport(sender: EmailSender, webUrl: string): AlertTransport {
  const origin = webUrl.replace(/\/$/, "");

  return async (channel, payload) => {
    const cfg = (channel.config ?? {}) as { email?: string; recipients?: string[] };
    const recipients = cfg.recipients ?? (cfg.email ? [cfg.email] : []);
    if (recipients.length === 0) throw new Error("EMAIL channel is missing email/recipients.");

    const rendered = renderEmail({
      template: "incident",
      to: recipients.join(","),
      incidentTitle: payload.title,
      severity: payload.severity ?? "unknown",
      description: payload.summary ?? `Monitor ${payload.monitorName} is ${payload.kind}.`,
      // Must match the Next.js route (apps/web/app/dashboard/incidents/[id]).
      statusPageUrl: `${origin}/dashboard/incidents/${payload.incidentId}`,
    });

    // Throws on a provider failure — the processor turns that into a FAILED
    // delivery with the real error and writes no NOTIFICATION_SENT event.
    const { providerMessageId } = await sender.send({
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template: "incident",
    });
    return { providerMessageId };
  };
}
