import { PrismaClient } from "@prisma/client";

// Re-export the Prisma namespace as a value (not `export type`): it carries
// runtime members like Prisma.PrismaClientKnownRequestError that consumers
// (e.g. the API error handler) use with `instanceof`.
export { Prisma } from "@prisma/client";
export * from "@prisma/client";

export interface CreatePrismaOptions {
  /** Defaults to process.env.DATABASE_URL */
  databaseUrl?: string;
  /** Enable query logging (development only — queries may contain PII). */
  logQueries?: boolean;
}

/**
 * One PrismaClient per process. Long-lived services (api, worker) call this
 * once at bootstrap; serverless-style reuse is also safe via the module cache.
 */
export function createPrisma(options: CreatePrismaOptions = {}): PrismaClient {
  return new PrismaClient({
    datasources: options.databaseUrl ? { db: { url: options.databaseUrl } } : undefined,
    log: options.logQueries
      ? [
          { level: "query", emit: "stdout" },
          { level: "warn", emit: "stdout" },
          { level: "error", emit: "stdout" },
        ]
      : [{ level: "error", emit: "stdout" }],
  });
}

let cached: PrismaClient | undefined;

/** Shared default client (module-level singleton). */
export function getPrisma(): PrismaClient {
  cached ??= createPrisma({ logQueries: process.env.PRISMA_LOG_QUERIES === "true" });
  return cached;
}
