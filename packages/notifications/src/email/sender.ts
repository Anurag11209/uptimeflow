import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { EmailConfig } from "@backend-uptime/config/email";
import type { EmailSender, OutboundEmail } from "../types.js";
import type { EmailMetrics } from "./metrics.js";
import { createEmailProvider } from "./provider-factory.js";
import type { EmailProvider, ProviderLogger } from "./provider.js";

export interface SenderConfig {
  provider: "ses" | "resend" | "smtp";
  from: string;
  resendApiKey?: string;
  smtpUrl?: string;
  /** SES (AWS) configuration — required when provider="ses". */
  email?: EmailConfig;
  logger?: ProviderLogger;
  metrics?: EmailMetrics;
}

/**
 * Adapt the richer EmailProvider to the queue processor's EmailSender, so the
 * BullMQ email worker can drive any provider (SES included) unchanged. The
 * template name is threaded through for provider-side logging/metrics labels.
 */
export function emailSenderFromProvider(provider: EmailProvider): EmailSender {
  return {
    async send(email: OutboundEmail) {
      const result = await provider.sendEmail({
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        template: email.template,
      });
      return { providerMessageId: result.messageId };
    },
  };
}

class ResendSender implements EmailSender {
  private readonly client: Resend;
  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutboundEmail): Promise<{ providerMessageId: string | null }> {
    const { data, error } = await this.client.emails.send({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    if (error) {
      throw new Error(`Resend delivery failed: ${error.name} ${error.message}`);
    }
    return { providerMessageId: data?.id ?? null };
  }
}

class SmtpSender implements EmailSender {
  private readonly transport: nodemailer.Transporter;
  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport(smtpUrl);
  }

  async send(email: OutboundEmail): Promise<{ providerMessageId: string | null }> {
    const info = await this.transport.sendMail({
      from: this.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    return { providerMessageId: info.messageId ?? null };
  }
}

export function createEmailSender(config: SenderConfig): EmailSender {
  if (config.provider === "ses") {
    if (!config.email) throw new Error("EMAIL_PROVIDER=ses requires AWS email configuration.");
    const provider = createEmailProvider({
      config: config.email,
      kind: "ses",
      logger: config.logger,
      metrics: config.metrics,
    });
    return emailSenderFromProvider(provider);
  }
  if (config.provider === "resend") {
    if (!config.resendApiKey) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY.");
    return new ResendSender(config.resendApiKey, config.from);
  }
  if (!config.smtpUrl) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL.");
  return new SmtpSender(config.smtpUrl, config.from);
}

export type { EmailConfig };
