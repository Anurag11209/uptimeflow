import type { EmailConfig } from "@backend-uptime/config/email";
import type { EmailMetrics } from "./metrics.js";
import type { EmailProvider, ProviderLogger } from "./provider.js";
import { LoggingEmailProvider } from "./logging-provider.js";
import { createSesClient } from "./ses-client.js";
import { SesEmailProvider } from "./ses-provider.js";

export type EmailProviderKind = "ses" | "logging";

export interface CreateEmailProviderOptions {
  config: EmailConfig;
  /** Which provider to build. Defaults to SES when credentials are present, else logging. */
  kind?: EmailProviderKind;
  logger?: ProviderLogger;
  metrics?: EmailMetrics;
  sendsPerSecond?: number;
}

/**
 * Construct the configured EmailProvider. SES is used when explicitly requested
 * or when static credentials are present; otherwise the logging provider keeps
 * local/dev environments working without AWS access.
 */
export function createEmailProvider(options: CreateEmailProviderOptions): EmailProvider {
  const kind = options.kind ?? (options.config.hasStaticCredentials ? "ses" : "logging");
  if (kind === "ses") {
    return new SesEmailProvider({
      client: createSesClient(options.config),
      config: options.config,
      logger: options.logger,
      metrics: options.metrics,
      sendsPerSecond: options.sendsPerSecond,
    });
  }
  return new LoggingEmailProvider(options.logger);
}
