import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    DATABASE_URL: z
      .string()
      .url()
      .default("postgresql://uptime:uptime@localhost:5432/backend_uptime?schema=public"),
    /** Public web app URL — used to build links in alert/incident emails. */
    WEB_URL: z.string().url().default("http://localhost:3000"),

    EMAIL_PROVIDER: z.enum(["smtp", "resend", "ses"]).default("smtp"),
    EMAIL_FROM: z.string().default("Backend Uptime <noreply@backenduptime.local>"),
    RESEND_API_KEY: z.string().optional(),
    SMTP_URL: z.string().default("smtp://localhost:1025"),

    // Amazon SES (used when EMAIL_PROVIDER=ses). Credentials are optional — the
    // AWS default credential chain (IAM role) applies when omitted.
    AWS_REGION: z.string().default("us-east-1"),
    AWS_ACCESS_KEY_ID: z.string().optional(),
    AWS_SECRET_ACCESS_KEY: z.string().optional(),
    EMAIL_MAX_RETRIES: z.coerce.number().int().min(1).max(10).default(3),

    /** Parallel email jobs per worker process. */
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),

    // ── Monitoring engine ──────────────────────────────────────────────
    MONITORING_ENABLED: z
      .enum(["true", "false"])
      .default("true")
      .transform((v) => v === "true"),
    /** Comma-separated probe regions this worker serves (e.g. "NA_EAST,EU_WEST"). */
    PROBE_REGIONS: z.string().default("NA_EAST"),
    /** Parallel monitor checks per region worker. */
    MONITOR_CONCURRENCY: z.coerce.number().int().min(1).max(500).default(20),
    /** How often the scheduler reconciles repeatable checks from the DB (ms). */
    SCHEDULER_SYNC_INTERVAL_MS: z.coerce.number().int().min(5_000).default(30_000),

    OTEL_SERVICE_NAME: z.string().default("backend-uptime-worker"),
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
  });

export type WorkerEnv = z.infer<typeof schema>;

export function parseEnv(source: NodeJS.ProcessEnv): WorkerEnv {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`Invalid worker environment:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}
