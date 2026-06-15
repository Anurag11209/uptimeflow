/**
 * Entrypoint. Order matters:
 *   1. validate env (fail fast)
 *   2. start tracing (must load before Express/ioredis for instrumentation)
 *   3. dynamically import + run the bootstrap
 */
import { parseEnv } from "./env.js";
import { createLogger, startTracing } from "./telemetry.js";

const env = parseEnv(process.env);
const logger = createLogger(env);

const stopTracing = await startTracing(env, logger);
const { bootstrap } = await import("./bootstrap.js");

const api = await bootstrap(env, logger);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutdown signal received");

  // Hard exit if graceful shutdown hangs (stuck connections, slow Redis).
  const force = setTimeout(() => {
    logger.error("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 10_000);
  force.unref();

  await api.stop();
  await stopTracing();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "uncaught exception — exiting");
  process.exit(1);
});
