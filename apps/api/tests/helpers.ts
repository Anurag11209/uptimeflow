import { pino } from "pino";
import type { PrismaClient } from "@backend-uptime/db";
import type { Env } from "../src/env.js";
import type { GetSession, SessionData } from "../src/context.js";
import { createServer, type ServerDeps } from "../src/server.js";
import { createMetrics } from "../src/telemetry.js";

export const testEnv = {
  NODE_ENV: "test",
  API_PORT: 0,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:4000",
  WEB_URL: "http://localhost:3000",
  EMAIL_PROVIDER: "smtp",
  EMAIL_FROM: "test@test.local",
  SMTP_URL: "smtp://localhost:1025",
  RATE_LIMIT_POINTS: 120,
  RATE_LIMIT_WINDOW_SECONDS: 60,
  OTEL_SERVICE_NAME: "api-test",
  LOG_LEVEL: "fatal",
  corsOrigins: ["http://localhost:3000"],
  isProduction: false,
  enableOpenApiReference: false,
} as unknown as Env;

export function sessionFor(userId: string): SessionData {
  return {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: userId,
      emailVerified: true,
      image: null,
      twoFactorEnabled: false,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    },
    session: {
      id: `ses_${userId}`,
      userId,
      token: "tok",
      expiresAt: new Date(Date.now() + 86_400_000),
      activeOrganizationId: null,
    },
  };
}

/** getSession double: authenticates when an `x-test-user` header is present. */
export const headerGetSession: GetSession = async (headers) => {
  const userId = headers.get("x-test-user");
  return userId ? sessionFor(userId) : null;
};

export function buildServer(overrides: Partial<ServerDeps> = {}) {
  const deps: ServerDeps = {
    env: testEnv,
    logger: pino({ level: "silent" }),
    prisma: {
      $queryRaw: async () => [{ "?column?": 1 }],
      member: {
        findFirst: async () => null,
        findMany: async () => [],
      },
    } as unknown as PrismaClient,
    redis: { ping: async () => "PONG" },
    authHandler: async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    getSession: async () => null,
    metrics: createMetrics(),
    rateLimiter: null,
    ...overrides,
  };
  return createServer(deps);
}
