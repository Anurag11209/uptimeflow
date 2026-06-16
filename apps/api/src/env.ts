import { z } from "zod";

const booleanString = z.enum(["true", "false"]).transform((value) => value === "true");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),

    BETTER_AUTH_SECRET: z.string().min(32, "Must be at least 32 characters. Generate with: openssl rand -base64 32"),
    /** Public URL of this API service (Better Auth base URL). */
    BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
    /** Public URL of the web app — trusted origin + email link target. */
    WEB_URL: z.string().url().default("http://localhost:3000"),
    /** Extra comma-separated origins allowed for CORS (previews, custom domains). */
    CORS_ORIGINS: z.string().optional(),

    /** Bearer token protecting GET /metrics in production. */
    METRICS_TOKEN: z.string().min(16).optional(),

    GITHUB_CLIENT_ID: z.string().optional(),
    GITHUB_CLIENT_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),

    EMAIL_PROVIDER: z.enum(["smtp", "resend", "ses"]).default("smtp"),
    EMAIL_FROM: z.string().default("Backend Uptime <noreply@backenduptime.local>"),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().default("smtp://localhost:1025"),

    // Amazon SES (used when EMAIL_PROVIDER=ses); credentials optional (IAM role).
    AWS_REGION: z.string().default("us-east-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    EMAIL_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),

    // Stripe billing. Optional so the app boots without billing configured
    // (local dev, CI, self-hosters who don't charge). When the secret key is
    // present the webhook secret must be too — see superRefine below.
    STRIPE_SECRET_KEY: z.string().min(1).optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),

    RATE_LIMIT_POINTS: z.coerce.number().int().min(1).default(120),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),

    ENABLE_OPENAPI_REFERENCE: booleanString.optional(),

    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    OTEL_SERVICE_NAME: z.string().default("backend-uptime-api"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === "resend" && !env.RESEND_API_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RESEND_API_KEY"],
        message: "Required when EMAIL_PROVIDER=resend.",
      });
    }
    for (const provider of ["GITHUB", "GOOGLE"] as const) {
      const id = env[`${provider}_CLIENT_ID`];
      const secret = env[`${provider}_CLIENT_SECRET`];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [`${provider}_CLIENT_SECRET`],
          message: `${provider}_CLIENT_ID and ${provider}_CLIENT_SECRET must be set together.`,
        });
      }
    }
    if (env.NODE_ENV === "production" && !env.METRICS_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["METRICS_TOKEN"],
        message: "Required in production — /metrics must not be public.",
      });
    }
    // Webhook signature verification is impossible without the signing secret,
    // so a configured Stripe integration must supply both.
    if (env.STRIPE_SECRET_KEY && !env.STRIPE_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_WEBHOOK_SECRET"],
        message: "Required when STRIPE_SECRET_KEY is set — webhooks can't be verified without it.",
      });
    }
  });

export type Env = z.infer<typeof schema> & {
  corsOrigins: string[];
  isProduction: boolean;
  enableOpenApiReference: boolean;
  /** True when Stripe billing is fully configured (secret + webhook secret). */
  billingEnabled: boolean;
};

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  const env = result.data;
  const extraOrigins = env.CORS_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
  return {
    ...env,
    corsOrigins: [...new Set([env.WEB_URL, ...extraOrigins])],
    isProduction: env.NODE_ENV === "production",
    enableOpenApiReference: env.ENABLE_OPENAPI_REFERENCE ?? env.NODE_ENV !== "production",
    billingEnabled: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
  };
}
