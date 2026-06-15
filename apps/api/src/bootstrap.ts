import http from "node:http";
import { Redis } from "ioredis";
import { createPrisma } from "@backend-uptime/db";
import { createAuth } from "@backend-uptime/auth";
import { createEmailProvider, createEmailQueue, createQueueConnection } from "@backend-uptime/notifications";
import { parseEmailConfig } from "@backend-uptime/config/email";
import type { Env } from "./env.js";
import type { SessionData } from "./context.js";
import { createApiRateLimiter } from "./middleware/rate-limit.js";
import { createServer } from "./server.js";
import { createAuditLogService } from "./services/audit-log.service.js";
import { createMetrics, type Logger } from "./telemetry.js";

export interface RunningApi {
  stop: () => Promise<void>;
}

export async function bootstrap(env: Env, logger: Logger): Promise<RunningApi> {
  const prisma = createPrisma({ databaseUrl: env.DATABASE_URL });

  // Two Redis connections by design: BullMQ requires maxRetriesPerRequest=null
  // on its connection; the general-purpose client keeps default retry behavior
  // for auth session storage, rate limiting, and readiness checks.
  const redis = new Redis(env.REDIS_URL, { lazyConnect: false });
  const queueConnection = createQueueConnection(env.REDIS_URL);
  const emailQueue = createEmailQueue(queueConnection);

  const auditLogs = createAuditLogService({ prisma, logger });

  const auth = createAuth({
    prisma,
    redis,
    emailQueue,
    secret: env.BETTER_AUTH_SECRET,
    baseUrl: env.BETTER_AUTH_URL,
    webUrl: env.WEB_URL,
    isProduction: env.isProduction,
    github:
      env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
        ? { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET }
        : undefined,
    google:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }
        : undefined,
    auditLog: (event) => auditLogs.log(event),
    enableOpenApiReference: env.enableOpenApiReference,
  });

  // Email provider for the internal SES health endpoint.
  const emailProvider = createEmailProvider({
    config: parseEmailConfig(process.env),
    kind: env.EMAIL_PROVIDER === "ses" ? "ses" : "logging",
    logger,
  });

  const app = createServer({
    env,
    logger,
    prisma,
    redis,
    authHandler: (request) => auth.handler(request),
    getSession: async (headers) =>
      (await auth.api.getSession({ headers })) as SessionData | null,
    metrics: createMetrics(),
    rateLimiter: createApiRateLimiter(redis, env),
    emailProvider,
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(env.API_PORT, resolve));
  logger.info(
    { port: env.API_PORT, openApiReference: env.enableOpenApiReference },
    "api listening",
  );

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info("shutting down api");

    // Stop accepting new connections, then drain dependencies.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await emailQueue.close().catch((err) => logger.warn({ err }, "queue close failed"));
    await queueConnection.quit().catch(() => queueConnection.disconnect());
    await redis.quit().catch(() => redis.disconnect());
    await prisma.$disconnect().catch((err) => logger.warn({ err }, "prisma disconnect failed"));
    logger.info("api stopped");
  };

  return { stop };
}
