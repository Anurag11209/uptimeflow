/**
 * The port through which an escalation step reaches a human.
 *
 * USER and SCHEDULE targets resolve to a person, not to an AlertChannel, so
 * they cannot travel the Phase-1 alert-channel transports —
 * `NotificationDelivery.channelId` is non-null, so there is no row shape for a
 * channel-less page. Rather than change that schema, the engine depends on this
 * port and the worker supplies an implementation backed by the transactional
 * email queue: the same route `status-notifier` already uses to mail a person
 * who has no alert channel.
 *
 * Kept as an injected port (like `alerts`, `integrations` and `escalation` in
 * the check pipeline) so `packages/monitoring` never has to own a queue
 * connection or an email template.
 */
export interface ResponderPage {
  incidentId: string;
  organizationId: string;
  userId: string;
  email: string;
  userName: string;
  /** How this responder was selected: "user" | "schedule:rotation" | "schedule:override". */
  via: string;
  /** The step position that paged them — part of the delivery's dedupe key. */
  step: number;
  incidentTitle: string;
  severity: string | null;
  summary: string | null;
  monitorName: string | null;
}

export interface ResponderNotifier {
  /**
   * Deliver one page to one human. Throws on failure; the engine records the
   * outcome per responder rather than failing the whole step, so one bad
   * address cannot stop the rest of the rotation being paged.
   */
  page(notification: ResponderPage): Promise<void>;
}
