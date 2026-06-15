import type { EmailConfig } from "@backend-uptime/config/email";
import {
  classifyEmailError,
  withRetry,
  type BulkEmailResult,
  type EmailHealth,
  type EmailMessage,
  type EmailProvider,
  type EmailSendResult,
  type ProviderLogger,
} from "./provider.js";
import { noopEmailMetrics, type EmailMetrics } from "./metrics.js";

/** Structural SES SendEmail input (sesv2 simple content). */
export interface SesSendInput {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  ReplyToAddresses?: string[];
  Content: {
    Simple: {
      Subject: { Data: string; Charset: string };
      Body: { Html: { Data: string; Charset: string }; Text: { Data: string; Charset: string } };
    };
  };
}

export interface SesSendResponse {
  MessageId?: string;
  $metadata?: { httpStatusCode?: number };
}

export interface SesAccountResponse {
  SendingEnabled?: boolean;
  $metadata?: { httpStatusCode?: number };
}

/**
 * The two SES operations the provider needs, decoupled from the AWS SDK so the
 * provider logic (retries, classification, metrics) is unit-testable with a fake.
 */
export interface SesClientLike {
  sendEmail(input: SesSendInput): Promise<SesSendResponse>;
  getAccount(): Promise<SesAccountResponse>;
  destroy?(): void;
}

export interface SesEmailProviderDeps {
  client: SesClientLike;
  config: EmailConfig;
  logger?: ProviderLogger;
  metrics?: EmailMetrics;
  /** Bulk-send throttle (messages/sec) to stay under the SES sending rate. */
  sendsPerSecond?: number;
}

const recipientLabel = (to: string | string[]): string => (Array.isArray(to) ? to.join(", ") : to);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Amazon SES (v2) email provider.
 *
 * - HTML + plain-text (multipart) via SES "Simple" content.
 * - Exponential-backoff retries on throttling / 5xx / network errors only.
 * - Structured logs and metrics on every attempt (provider, recipient,
 *   template, status, error).
 * - Bulk sends are throttled to a configurable rate to protect the SES quota.
 */
export class SesEmailProvider implements EmailProvider {
  readonly name = "ses";
  private readonly client: SesClientLike;
  private readonly config: EmailConfig;
  private readonly logger?: ProviderLogger;
  private readonly metrics: EmailMetrics;
  private readonly minIntervalMs: number;

  constructor(deps: SesEmailProviderDeps) {
    this.client = deps.client;
    this.config = deps.config;
    this.logger = deps.logger;
    this.metrics = deps.metrics ?? noopEmailMetrics;
    this.minIntervalMs = Math.ceil(1000 / Math.max(1, deps.sendsPerSecond ?? 14));
  }

  private buildInput(message: EmailMessage): SesSendInput {
    return {
      FromEmailAddress: this.config.from,
      Destination: { ToAddresses: Array.isArray(message.to) ? message.to : [message.to] },
      ...(message.replyTo ? { ReplyToAddresses: [message.replyTo] } : {}),
      Content: {
        Simple: {
          Subject: { Data: message.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: message.html, Charset: "UTF-8" },
            Text: { Data: message.text, Charset: "UTF-8" },
          },
        },
      },
    };
  }

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    const labels = { provider: this.name, template: message.template };
    const recipient = recipientLabel(message.to);
    const start = performance.now();

    try {
      const response = await withRetry(() => this.client.sendEmail(this.buildInput(message)), {
        maxAttempts: this.config.maxRetries,
        onRetry: (attempt, error, delayMs) => {
          this.metrics.incRetry({ ...labels, errorKind: error.kind });
          this.logger?.warn(
            { provider: this.name, recipient, template: message.template, attempt, errorKind: error.kind, error: error.message, delayMs },
            "email send retry",
          );
        },
      });

      const durationMs = Math.round(performance.now() - start);
      this.metrics.incSent(labels);
      this.metrics.observeDuration(durationMs, { ...labels, status: "sent" });
      this.logger?.info(
        { provider: this.name, recipient, template: message.template, status: "sent", messageId: response.MessageId ?? null, durationMs },
        "email sent",
      );
      return { messageId: response.MessageId ?? null, provider: this.name };
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      const classified = classifyEmailError(error);
      this.metrics.incFailed({ ...labels, errorKind: classified.kind });
      this.metrics.observeDuration(durationMs, { ...labels, status: "failed" });
      this.logger?.error(
        { provider: this.name, recipient, template: message.template, status: "failed", errorKind: classified.kind, error: classified.message, durationMs },
        "email send failed",
      );
      throw error;
    }
  }

  async sendBulkEmail(messages: EmailMessage[]): Promise<BulkEmailResult> {
    const results: BulkEmailResult["results"] = [];
    let sent = 0;
    let failed = 0;

    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]!;
      const to = recipientLabel(message.to);
      try {
        const result = await this.sendEmail(message);
        results.push({ to, messageId: result.messageId });
        sent++;
      } catch (error) {
        results.push({ to, messageId: null, error: classifyEmailError(error).message });
        failed++;
      }
      // Throttle to protect the SES sending rate (skip after the last message).
      if (i < messages.length - 1) await sleep(this.minIntervalMs);
    }

    this.logger?.info({ provider: this.name, total: messages.length, sent, failed }, "bulk email complete");
    return { sent, failed, results };
  }

  async healthCheck(): Promise<EmailHealth> {
    try {
      const account = await this.client.getAccount();
      const enabled = account.SendingEnabled !== false;
      return {
        provider: this.name,
        status: enabled ? "healthy" : "unhealthy",
        region: this.config.region,
        detail: enabled ? undefined : "SES sending is disabled for this account.",
      };
    } catch (error) {
      const classified = classifyEmailError(error);
      return {
        provider: this.name,
        status: "unhealthy",
        region: this.config.region,
        detail: `${classified.name}: ${classified.message}`,
      };
    }
  }
}
