import type { EmailErrorKind, ProviderLogger } from "./provider.js";

export interface EmailMetricLabels {
  provider: string;
  template?: string;
}

/**
 * Sink for email-delivery metrics. The provider emits to this interface so the
 * concrete backend (Prometheus, logs, no-op) is a wiring decision:
 *   emails_sent_total · emails_failed_total · email_send_duration_ms · email_retry_total
 */
export interface EmailMetrics {
  incSent(labels: EmailMetricLabels): void;
  incFailed(labels: EmailMetricLabels & { errorKind: EmailErrorKind }): void;
  incRetry(labels: EmailMetricLabels & { errorKind: EmailErrorKind }): void;
  observeDuration(durationMs: number, labels: EmailMetricLabels & { status: "sent" | "failed" }): void;
}

export const noopEmailMetrics: EmailMetrics = {
  incSent: () => {},
  incFailed: () => {},
  incRetry: () => {},
  observeDuration: () => {},
};

/**
 * Metrics sink that records into structured logs — useful in the worker, which
 * has no Prometheus scrape endpoint of its own. Mirrors the four metric names.
 */
export function loggingEmailMetrics(logger: ProviderLogger): EmailMetrics {
  return {
    incSent: (labels) => logger.info({ metric: "emails_sent_total", ...labels }, "metric"),
    incFailed: (labels) => logger.info({ metric: "emails_failed_total", ...labels }, "metric"),
    incRetry: (labels) => logger.info({ metric: "email_retry_total", ...labels }, "metric"),
    observeDuration: (durationMs, labels) =>
      logger.info({ metric: "email_send_duration_ms", durationMs, ...labels }, "metric"),
  };
}
