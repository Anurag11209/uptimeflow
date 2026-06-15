/**
 * Queue consumer process.
 *
 * Runs the Phase 1 transactional-email worker and the Phase 2 monitoring
 * engine in one process: a Scheduler that turns the monitor table into
 * repeatable BullMQ checks, plus one check Worker per probe region. All are
 * independent BullMQ Workers, so the process scales horizontally and a region
 * can be split into its own deployment unchanged.
 */
import { Worker } from "bullmq";
import { pino } from "pino";
import { createPrisma, type ProbeRegion } from "@backend-uptime/db";
import {
  ALERT_QUEUE_NAME,
  ESCALATION_QUEUE_NAME,
  PROBE_REGIONS,
  checkQueueName,
  createAlertDispatcher,
  createAlertProcessor,
  createAlertQueue,
  createCheckProcessor,
  createCheckQueues,
  createEscalationProcessor,
  createEscalationQueue,
  createEscalationStarter,
  createIntegrationDispatcher,
  createIntegrationProcessor,
  createIntegrationQueue,
  createQueueConnection as createMonitorConnection,
  createScheduler,
  loggingTransport,
  webhookTransport,
  INTEGRATION_QUEUE_NAME,
  type AlertJobData,
  type CheckJobData,
  type EscalationJobData,
  type IntegrationJobData,
  type SchedulableQueue,
} from "@backend-uptime/monitoring";
import {
  QUEUE_NAMES,
  createEmailProcessor,
  createEmailProvider,
  createEmailSender,
  createQueueConnection,
  emailSenderFromProvider,
  loggingEmailMetrics,
  renderEmail,
  type EmailJob,
  type EmailProvider,
} from "@backend-uptime/notifications";
import type { AlertTransport } from "@backend-uptime/monitoring";
import type { EmailConfig } from "@backend-uptime/config/email";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: env.OTEL_SERVICE_NAME },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: { level: (label) => ({ level: label }) },
});

const closers: Array<() => Promise<unknown>> = [];

// ───────────────────────────── Email provider ───────────────────────────────
const emailConfig: EmailConfig = {
  region: env.AWS_REGION,
  accessKeyId: env.AWS_ACCESS_KEY_ID,
  secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  from: env.EMAIL_FROM,
  maxRetries: env.EMAIL_MAX_RETRIES,
  hasStaticCredentials: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY),
};
const emailMetrics = loggingEmailMetrics(logger);

// Build the email provider once; the email queue worker and the EMAIL alert
// transport share it. SES when EMAIL_PROVIDER=ses, else the logging provider.
const emailProvider: EmailProvider = createEmailProvider({
  config: emailConfig,
  kind: env.EMAIL_PROVIDER === "ses" ? "ses" : "logging",
  logger,
  metrics: emailMetrics,
});

// ───────────────────────────── Email worker ─────────────────────────────────
const sender =
  env.EMAIL_PROVIDER === "ses"
    ? emailSenderFromProvider(emailProvider)
    : createEmailSender({
        provider: env.EMAIL_PROVIDER,
        from: env.EMAIL_FROM,
        resendApiKey: env.RESEND_API_KEY,
        smtpUrl: env.SMTP_URL,
      });

/** EMAIL alert-channel transport: render an incident email and send it via SES. */
function emailAlertTransport(provider: EmailProvider, webUrl: string): AlertTransport {
  return async (channel, payload) => {
    const cfg = (channel.config ?? {}) as { email?: string; recipients?: string[] };
    const recipients = cfg.recipients ?? (cfg.email ? [cfg.email] : []);
    if (recipients.length === 0) throw new Error("EMAIL channel is missing email/recipients.");
    const rendered = renderEmail({
      template: "incident",
      to: recipients.join(","),
      incidentTitle: payload.title,
      severity: payload.severity ?? "unknown",
      description: payload.summary ?? `Monitor ${payload.monitorName} is ${payload.kind}.`,
      statusPageUrl: `${webUrl}/incidents/${payload.incidentId}`,
    });
    const result = await provider.sendEmail({
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      template: "incident",
    });
    return { providerMessageId: result.messageId };
  };
}

const emailConnection = createQueueConnection(env.REDIS_URL);
const emailWorker = new Worker<EmailJob>(QUEUE_NAMES.email, createEmailProcessor({ sender, logger }), {
  connection: emailConnection,
  concurrency: env.WORKER_CONCURRENCY,
  stalledInterval: 30_000,
  maxStalledCount: 2,
});
emailWorker.on("ready", () => logger.info({ queue: QUEUE_NAMES.email }, "worker ready"));
emailWorker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, template: job?.data.template, attempts: job?.attemptsMade, err: err.message },
    "email job failed",
  ),
);
emailWorker.on("error", (err) => logger.error({ err }, "email worker error"));
closers.push(async () => {
  await emailWorker.close();
  await emailConnection.quit().catch(() => emailConnection.disconnect());
});

// ───────────────────── Integration delivery worker ──────────────────────────
// Always on (independent of MONITORING_ENABLED): drains the integration queue
// that the API (test sends) and the monitoring pipeline (incident events) fill.
const integrationDeliveryPrisma = createPrisma({ databaseUrl: env.DATABASE_URL });
const integrationConnection = createQueueConnection(env.REDIS_URL);
const integrationWorker = new Worker<IntegrationJobData>(
  INTEGRATION_QUEUE_NAME,
  createIntegrationProcessor({ prisma: integrationDeliveryPrisma, logger }),
  { connection: integrationConnection, concurrency: env.WORKER_CONCURRENCY, stalledInterval: 30_000, maxStalledCount: 2 },
);
integrationWorker.on("ready", () => logger.info({ queue: INTEGRATION_QUEUE_NAME }, "integration worker ready"));
integrationWorker.on("failed", (job, err) =>
  logger.error(
    { jobId: job?.id, deliveryId: job?.data.deliveryId, attempts: job?.attemptsMade, err: err.message },
    "integration job failed",
  ),
);
integrationWorker.on("error", (err) => logger.error({ err }, "integration worker error"));
closers.push(async () => {
  await integrationWorker.close();
  await integrationConnection.quit().catch(() => integrationConnection.disconnect());
  await integrationDeliveryPrisma.$disconnect();
});

// ─────────────────────────── Monitoring engine ──────────────────────────────
if (env.MONITORING_ENABLED) {
  const known = new Set<string>(PROBE_REGIONS);
  const regions = env.PROBE_REGIONS.split(",")
    .map((r) => r.trim())
    .filter((r) => known.has(r)) as ProbeRegion[];
  if (regions.length === 0) regions.push("NA_EAST");

  const prisma = createPrisma({ databaseUrl: env.DATABASE_URL });
  closers.push(() => prisma.$disconnect());

  // Producer/scheduler connection shared across the region queues.
  const queueConnection = createMonitorConnection(env.REDIS_URL);
  const checkQueues = createCheckQueues(queueConnection, regions);

  const scheduler = createScheduler({
    prisma,
    queues: checkQueues as Map<ProbeRegion, SchedulableQueue>,
    logger,
    defaultRegion: regions[0],
    syncIntervalMs: env.SCHEDULER_SYNC_INTERVAL_MS,
  });
  const { stop: stopScheduler } = scheduler.start();
  closers.push(async () => {
    stopScheduler();
    await Promise.all([...checkQueues.values()].map((q) => q.close()));
    await queueConnection.quit().catch(() => queueConnection.disconnect());
  });

  // Alerting: a dispatcher (producer) the pipeline calls on incident flips, and
  // a worker that performs the actual sends queue-first (ADR-003).
  const alertConnection = createMonitorConnection(env.REDIS_URL);
  const alertQueue = createAlertQueue(alertConnection);
  const alerts = createAlertDispatcher({ prisma, queue: alertQueue, logger });
  closers.push(async () => {
    await alertQueue.close();
    await alertConnection.quit().catch(() => alertConnection.disconnect());
  });

  // Integrations: fan incident open/resolve out to Slack/Discord/webhooks. The
  // delivery worker that drains this queue is started unconditionally above.
  const integrationDispatchQueue = createIntegrationQueue(queueConnection);
  const integrations = createIntegrationDispatcher({
    prisma,
    queue: integrationDispatchQueue,
    webUrl: env.WEB_URL,
    logger,
  });
  closers.push(() => integrationDispatchQueue.close());

  const alertWorkerConnection = createMonitorConnection(env.REDIS_URL);
  const alertWorker = new Worker<AlertJobData>(
    ALERT_QUEUE_NAME,
    createAlertProcessor({
      prisma,
      transports: { WEBHOOK: webhookTransport, EMAIL: emailAlertTransport(emailProvider, env.WEB_URL) },
      fallback: loggingTransport(logger),
      logger,
    }),
    { connection: alertWorkerConnection, concurrency: env.MONITOR_CONCURRENCY, stalledInterval: 30_000, maxStalledCount: 2 },
  );
  alertWorker.on("ready", () => logger.info({ queue: ALERT_QUEUE_NAME }, "alert worker ready"));
  alertWorker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, deliveryId: job?.data.deliveryId, err: err.message }, "alert job failed"),
  );
  alertWorker.on("error", (err) => logger.error({ err }, "alert worker error"));
  closers.push(async () => {
    await alertWorker.close();
    await alertWorkerConnection.quit().catch(() => alertWorkerConnection.disconnect());
  });

  // Escalation: a starter (producer) the pipeline calls when an incident opens
  // for a monitor with a policy, and a worker that fires the timed steps.
  const escalationConnection = createMonitorConnection(env.REDIS_URL);
  const escalationQueue = createEscalationQueue(escalationConnection);
  const escalation = createEscalationStarter({ prisma, queue: escalationQueue, logger });
  closers.push(async () => {
    await escalationQueue.close();
    await escalationConnection.quit().catch(() => escalationConnection.disconnect());
  });

  const escalationWorkerConnection = createMonitorConnection(env.REDIS_URL);
  const escalationWorker = new Worker<EscalationJobData>(
    ESCALATION_QUEUE_NAME,
    createEscalationProcessor({ prisma, queue: escalationQueue, alerts, logger }),
    { connection: escalationWorkerConnection, concurrency: env.MONITOR_CONCURRENCY, stalledInterval: 30_000, maxStalledCount: 2 },
  );
  escalationWorker.on("ready", () => logger.info({ queue: ESCALATION_QUEUE_NAME }, "escalation worker ready"));
  escalationWorker.on("failed", (job, err) =>
    logger.error({ jobId: job?.id, incidentId: job?.data.incidentId, err: err.message }, "escalation job failed"),
  );
  escalationWorker.on("error", (err) => logger.error({ err }, "escalation worker error"));
  closers.push(async () => {
    await escalationWorker.close();
    await escalationWorkerConnection.quit().catch(() => escalationWorkerConnection.disconnect());
  });

  const processCheck = createCheckProcessor({ prisma, alerts, integrations, escalation, logger });
  for (const region of regions) {
    // Each Worker needs its own blocking-capable connection.
    const connection = createMonitorConnection(env.REDIS_URL);
    const worker = new Worker<CheckJobData>(checkQueueName(region), processCheck, {
      connection,
      concurrency: env.MONITOR_CONCURRENCY,
      stalledInterval: 30_000,
      maxStalledCount: 2,
    });
    worker.on("ready", () => logger.info({ region }, "monitor worker ready"));
    worker.on("failed", (job, err) =>
      logger.error(
        { jobId: job?.id, monitorId: job?.data.monitorId, region, err: err.message },
        "check job failed",
      ),
    );
    worker.on("error", (err) => logger.error({ region, err }, "monitor worker error"));
    closers.push(async () => {
      await worker.close();
      await connection.quit().catch(() => connection.disconnect());
    });
  }

  logger.info({ regions, concurrency: env.MONITOR_CONCURRENCY }, "monitoring engine started");
}

// ──────────────────────────── Graceful shutdown ─────────────────────────────
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down worker");

  const force = setTimeout(() => {
    logger.error("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 15_000);
  force.unref();

  // close() waits for in-flight jobs before resolving.
  await Promise.allSettled(closers.map((close) => close()));
  logger.info("worker stopped");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "unhandled promise rejection");
});
