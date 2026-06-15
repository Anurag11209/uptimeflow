export * from "./types.js";
export * from "./queues.js";
export * from "./processor.js";
export { renderEmail } from "./email/templates.js";
export { createEmailSender, emailSenderFromProvider, type SenderConfig } from "./email/sender.js";

// Email provider layer (SES + abstractions).
export * from "./email/provider.js";
export * from "./email/metrics.js";
export * from "./email/provider-factory.js";
export {
  SesEmailProvider,
  type SesClientLike,
  type SesSendInput,
  type SesSendResponse,
  type SesAccountResponse,
  type SesEmailProviderDeps,
} from "./email/ses-provider.js";
export { createSesClient } from "./email/ses-client.js";
export { LoggingEmailProvider } from "./email/logging-provider.js";
