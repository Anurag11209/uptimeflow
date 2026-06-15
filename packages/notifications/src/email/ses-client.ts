import {
  GetAccountCommand,
  SendEmailCommand,
  SESv2Client,
  type SendEmailCommandInput,
} from "@aws-sdk/client-sesv2";
import type { EmailConfig } from "@backend-uptime/config/email";
import type { SesClientLike } from "./ses-provider.js";

/**
 * Builds the concrete AWS SDK (sesv2) client adapter. This is the only module
 * that imports the SDK — the provider logic depends solely on `SesClientLike`.
 *
 * Static credentials are used when present; otherwise the SDK's default
 * credential chain (IAM role / instance profile) applies. SDK-internal retries
 * are disabled (`maxAttempts: 1`) because the provider owns retry/backoff.
 */
export function createSesClient(config: EmailConfig): SesClientLike {
  const client = new SESv2Client({
    region: config.region,
    maxAttempts: 1,
    ...(config.hasStaticCredentials && config.accessKeyId && config.secretAccessKey
      ? { credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }
      : {}),
  });

  return {
    sendEmail: (input) => client.send(new SendEmailCommand(input as SendEmailCommandInput)),
    getAccount: () => client.send(new GetAccountCommand({})),
    destroy: () => client.destroy(),
  };
}
