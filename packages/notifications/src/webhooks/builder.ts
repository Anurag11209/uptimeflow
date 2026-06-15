import type { IntegrationEvent } from "../integrations/event.js";

export interface WebhookPayload {
  event: string;
  timestamp: string;
  data: {
    title: string;
    summary?: string;
    monitorName?: string;
    organizationName?: string;
    status?: string;
    severity?: string;
    url?: string;
  };
}

/**
 * Stable JSON envelope sent to customer webhook endpoints. The top-level
 * `event`/`timestamp` mirror the signed headers; `data` carries the event
 * detail. Keeping this shape stable is part of the public contract.
 */
export const WebhookMessageBuilder = {
  build(event: IntegrationEvent): WebhookPayload {
    return {
      event: event.event,
      timestamp: event.timestamp,
      data: {
        title: event.title,
        summary: event.summary,
        monitorName: event.monitorName,
        organizationName: event.organizationName,
        status: event.status,
        severity: event.severity,
        url: event.url,
      },
    };
  },
};
