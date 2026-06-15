import type {
  BulkEmailResult,
  EmailHealth,
  EmailMessage,
  EmailProvider,
  EmailSendResult,
  ProviderLogger,
} from "./provider.js";

const recipientLabel = (to: string | string[]): string => (Array.isArray(to) ? to.join(", ") : to);

/**
 * Development / fallback provider. Logs each message instead of sending, so the
 * pipeline runs end-to-end locally (and in CI) without AWS credentials. Always
 * reports healthy.
 */
export class LoggingEmailProvider implements EmailProvider {
  readonly name = "logging";
  private counter = 0;

  constructor(private readonly logger?: ProviderLogger) {}

  async sendEmail(message: EmailMessage): Promise<EmailSendResult> {
    const messageId = `logging-${(this.counter += 1)}`;
    this.logger?.info(
      { provider: this.name, recipient: recipientLabel(message.to), template: message.template, status: "sent", subject: message.subject },
      "email (logging provider — not delivered)",
    );
    return { messageId, provider: this.name };
  }

  async sendBulkEmail(messages: EmailMessage[]): Promise<BulkEmailResult> {
    const results: BulkEmailResult["results"] = [];
    for (const message of messages) {
      const { messageId } = await this.sendEmail(message);
      results.push({ to: recipientLabel(message.to), messageId });
    }
    return { sent: results.length, failed: 0, results };
  }

  async healthCheck(): Promise<EmailHealth> {
    return { provider: this.name, status: "healthy", detail: "logging provider (no delivery)" };
  }
}
