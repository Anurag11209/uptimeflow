import { z } from "zod";

/**
 * Email transport configuration (Amazon SES).
 *
 * AWS credentials are optional: when omitted, the AWS SDK's default credential
 * provider chain is used (IAM role / instance profile / shared config), which is
 * the recommended setup in production. Static keys are for local/dev or CI.
 */
export const emailConfigSchema = z.object({
  AWS_REGION: z.string().min(1).default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z
    .string()
    .min(3)
    .refine((v) => v.includes("@"), "EMAIL_FROM must be an email address (optionally `Name <addr>`).")
    .default("alerts@uptimeflow.in"),
  /** Max SES send attempts (1 = no retry). */
  EMAIL_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),
});

export interface EmailConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  from: string;
  maxRetries: number;
  /** True when explicit static credentials were supplied. */
  hasStaticCredentials: boolean;
}

export class EmailConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid email configuration:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    this.name = "EmailConfigError";
  }
}

/**
 * Validate and normalize email configuration from an environment-like record.
 * Throws EmailConfigError with a readable list of problems on failure.
 */
export function parseEmailConfig(source: Record<string, string | undefined>): EmailConfig {
  const result = emailConfigSchema.safeParse({
    AWS_REGION: source.AWS_REGION,
    AWS_ACCESS_KEY_ID: source.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: source.AWS_SECRET_ACCESS_KEY,
    EMAIL_FROM: source.EMAIL_FROM,
    EMAIL_MAX_RETRIES: source.EMAIL_MAX_RETRIES,
  });
  if (!result.success) {
    throw new EmailConfigError(
      result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const env = result.data;
  return {
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    from: env.EMAIL_FROM,
    maxRetries: env.EMAIL_MAX_RETRIES,
    hasStaticCredentials: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
  };
}
