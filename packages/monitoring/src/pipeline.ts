import type { CheckStatus, MonitorHealth, PrismaClient, ProbeRegion } from "@backend-uptime/db";
import type { AuditEvent } from "@backend-uptime/shared";
import type { AlertDispatcher } from "./alerting/dispatcher.js";
import type { EscalationStarter } from "./escalation/engine.js";
import { detectFlapping } from "./flapping.js";
import { DEFAULT_REGION } from "./queues.js";
import { transition, type MonitorState } from "./state-machine.js";
import type { AssertionDef, MonitorSnapshot, ProbeOutcome } from "./types.js";

const isSuccessStatus = (s: CheckStatus): boolean => s === "UP" || s === "DEGRADED";
const MAX_ERR = 500;

export interface PipelineLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
}

export interface ProcessOptions {
  region: ProbeRegion;
  now?: Date;
  /** True when this result is a heartbeat ping (so lastCheckedAt is stamped). */
  isHeartbeatPing?: boolean;
  /** Optional alert fan-out; when absent, incidents are recorded without alerts. */
  alerts?: AlertDispatcher;
  /** Optional escalation engine; used when the monitor has an escalation policy. */
  escalation?: EscalationStarter;
  logger?: PipelineLogger;
}

export interface ProcessResult {
  checkStatus: CheckStatus;
  previousHealth: MonitorHealth;
  newHealth: MonitorHealth;
  state: MonitorState;
  /** Incident-level transition: opened, resolved, or neither. */
  transition: "down" | "recovered" | null;
  inMaintenance: boolean;
  flapping: boolean;
  incidentId: string | null;
  alertsEnqueued: number;
}

/** Prisma monitor row shape the engine maps into a snapshot. */
export interface MonitorRow {
  id: string;
  organizationId: string;
  name: string;
  type: MonitorSnapshot["type"];
  url: string | null;
  host: string | null;
  port: number | null;
  httpMethod: MonitorSnapshot["httpMethod"];
  requestHeaders: unknown;
  requestBody: string | null;
  expectedStatus: number | null;
  keyword: string | null;
  keywordInverted: boolean;
  followRedirects: boolean;
  verifySsl: boolean;
  timeoutSeconds: number;
  retries: number;
  intervalSeconds: number;
  failureThreshold: number;
  successThreshold: number;
  escalationPolicyId: string | null;
  health: MonitorHealth;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastCheckedAt: Date | null;
  assertions: AssertionDef[];
}

/** Map a Prisma monitor row (with assertions) into a probe-ready snapshot. */
export function toSnapshot(row: MonitorRow): MonitorSnapshot {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    type: row.type,
    url: row.url,
    host: row.host,
    port: row.port,
    httpMethod: row.httpMethod,
    requestHeaders: (row.requestHeaders as Record<string, string> | null) ?? null,
    requestBody: row.requestBody,
    expectedStatus: row.expectedStatus,
    keyword: row.keyword,
    keywordInverted: row.keywordInverted,
    followRedirects: row.followRedirects,
    verifySsl: row.verifySsl,
    timeoutSeconds: row.timeoutSeconds,
    retries: row.retries,
    intervalSeconds: row.intervalSeconds,
    failureThreshold: row.failureThreshold,
    successThreshold: row.successThreshold,
    escalationPolicyId: row.escalationPolicyId,
    health: row.health,
    consecutiveFailures: row.consecutiveFailures,
    consecutiveSuccesses: row.consecutiveSuccesses,
    lastCheckedAt: row.lastCheckedAt,
    assertions: row.assertions,
  };
}

async function isInMaintenance(prisma: PrismaClient, monitorId: string, now: Date): Promise<boolean> {
  const window = await prisma.maintenanceWindow.findFirst({
    where: {
      suppressAlerts: true,
      startsAt: { lte: now },
      endsAt: { gte: now },
      monitors: { some: { id: monitorId } },
    },
    select: { id: true },
  });
  return window !== null;
}

async function writeAudit(prisma: PrismaClient, event: AuditEvent): Promise<void> {
  await prisma.auditLog.create({
    data: {
      organizationId: event.organizationId ?? null,
      actorId: event.actorId ?? null,
      actorType: event.actorType,
      action: event.action,
      resourceType: event.resourceType,
      resourceId: event.resourceId ?? null,
      metadata: (event.metadata ?? undefined) as object | undefined,
    },
  });
}

async function addEvent(
  prisma: PrismaClient,
  incidentId: string,
  type: string,
  message: string,
  now: Date,
  metadata?: Record<string, unknown>,
): Promise<void> {
  await prisma.incidentEvent.create({
    data: { incidentId, type: type as never, message, metadata: metadata as object | undefined, createdAt: now },
  });
}

async function openIncident(
  prisma: PrismaClient,
  monitor: MonitorSnapshot,
  outcome: ProbeOutcome,
  now: Date,
): Promise<string | null> {
  try {
    const incident = await prisma.incident.create({
      data: {
        organizationId: monitor.organizationId,
        monitorId: monitor.id,
        status: "OPEN",
        severity: "MAJOR",
        title: `${monitor.name} is down`,
        summary: outcome.errorMessage?.slice(0, MAX_ERR) ?? `${monitor.type} check failed`,
        cause: outcome.errorType ?? null,
        // Dedupe key: only one active "down" incident per monitor.
        fingerprint: `${monitor.id}:down`,
        startedAt: now,
        createdAt: now,
        events: {
          create: {
            type: "DETECTED",
            message: outcome.errorMessage?.slice(0, MAX_ERR) ?? null,
            metadata: { errorType: outcome.errorType ?? null, status: outcome.status },
            createdAt: now,
          },
        },
      },
      select: { id: true },
    });
    return incident.id;
  } catch {
    // Unique (monitorId, fingerprint): an open incident already exists.
    return null;
  }
}

async function findOpenIncidentId(prisma: PrismaClient, monitorId: string): Promise<string | null> {
  const open = await prisma.incident.findFirst({
    where: { monitorId, status: { not: "RESOLVED" } },
    orderBy: { startedAt: "desc" },
    select: { id: true },
  });
  return open?.id ?? null;
}

async function resolveIncident(prisma: PrismaClient, monitorId: string, now: Date): Promise<string | null> {
  const open = await prisma.incident.findFirst({
    where: { monitorId, status: { not: "RESOLVED" } },
    orderBy: { startedAt: "desc" },
    select: { id: true, startedAt: true },
  });
  if (!open) return null;

  const durationSec = Math.max(0, Math.round((now.getTime() - open.startedAt.getTime()) / 1000));
  await prisma.incident.update({
    where: { id: open.id },
    data: {
      status: "RESOLVED",
      resolvedAt: now,
      durationSec,
      // Free the dedupe key so a future outage can open a fresh incident.
      fingerprint: null,
      events: { create: { type: "RESOLVED", message: `Recovered after ${durationSec}s.`, createdAt: now } },
    },
  });
  return open.id;
}

/**
 * Result-processing pipeline. For one check outcome it:
 *   1. records the raw CheckResult (append-only),
 *   2. advances the monitor state machine (UP/PENDING/DOWN/RECOVERING/MAINTENANCE)
 *      using failure/success thresholds,
 *   3. updates the monitor's denormalized state,
 *   4. opens/resolves the incident, appends timeline events, audits the change,
 *      and fans alerts out to the monitor's channels — deduplicating when the
 *      monitor is flapping (alert suppressed, incident still recorded).
 *
 * Maintenance windows with suppressAlerts force MAINTENANCE and skip incidents.
 * All writes carry the monitor's organizationId, preserving tenant isolation.
 */
export async function processCheckResult(
  prisma: PrismaClient,
  monitor: MonitorSnapshot,
  outcome: ProbeOutcome,
  opts: ProcessOptions,
): Promise<ProcessResult> {
  const now = opts.now ?? new Date();
  const status = outcome.status;
  const success = isSuccessStatus(status);
  const failure = !success;

  const inMaintenance = await isInMaintenance(prisma, monitor.id, now);

  const decision = transition({
    current: monitor.health,
    success,
    priorConsecutiveFailures: monitor.consecutiveFailures,
    priorConsecutiveSuccesses: monitor.consecutiveSuccesses,
    failureThreshold: monitor.failureThreshold,
    successThreshold: monitor.successThreshold,
    inMaintenance,
  });

  // 1. raw result (firehose, append-only)
  await prisma.checkResult.create({
    data: {
      organizationId: monitor.organizationId,
      monitorId: monitor.id,
      region: opts.region,
      status,
      statusCode: outcome.statusCode ?? null,
      responseMs: outcome.responseMs ?? null,
      errorType: outcome.errorType ?? null,
      errorMessage: outcome.errorMessage?.slice(0, MAX_ERR) ?? null,
      checkedAt: now,
    },
  });

  // 2. denormalized monitor state. Heartbeat freshness evals must NOT bump
  //    lastCheckedAt (that is the last *ping* time); pings pass isHeartbeatPing.
  const touchLastChecked = monitor.type !== "HEARTBEAT" || opts.isHeartbeatPing === true;
  await prisma.monitor.update({
    where: { id: monitor.id },
    data: {
      health: decision.state,
      consecutiveFailures: decision.consecutiveFailures,
      consecutiveSuccesses: decision.consecutiveSuccesses,
      lastStatusCode: outcome.statusCode ?? null,
      lastResponseMs: outcome.responseMs ?? null,
      lastError: failure ? (outcome.errorMessage?.slice(0, MAX_ERR) ?? null) : null,
      ...(touchLastChecked ? { lastCheckedAt: now } : {}),
    },
  });

  // 3. incident lifecycle + timeline + audit + alerts
  let incidentId: string | null = null;
  let pipelineTransition: "down" | "recovered" | null = null;
  let flapping = false;
  let alertsEnqueued = 0;

  if (decision.incident === "open") {
    flapping = await detectFlapping(prisma, monitor.id, now);
    incidentId = await openIncident(prisma, monitor, outcome, now);
    if (incidentId) {
      pipelineTransition = "down";
      if (flapping) {
        // Alert deduplication: record the incident but suppress the notification.
        await addEvent(prisma, incidentId, "STATUS_CHANGED", "Flapping detected — alert suppressed.", now, {
          flapping: true,
        });
        await writeAudit(prisma, {
          organizationId: monitor.organizationId,
          actorType: "system",
          action: "monitor.flapping",
          resourceType: "monitor",
          resourceId: monitor.id,
          metadata: { incidentId, region: opts.region },
        });
        opts.logger?.warn({ monitorId: monitor.id, incidentId }, "monitor flapping — alert suppressed");
      } else {
        await writeAudit(prisma, {
          organizationId: monitor.organizationId,
          actorType: "system",
          action: "incident.opened",
          resourceType: "incident",
          resourceId: incidentId,
          metadata: { monitorId: monitor.id, region: opts.region, errorType: outcome.errorType ?? null },
        });
        // With an escalation policy, paging is driven by the escalation engine
        // (timed multi-step); otherwise blast the monitor's channels directly.
        if (monitor.escalationPolicyId && opts.escalation) {
          await opts.escalation.start({
            incidentId,
            organizationId: monitor.organizationId,
            monitorId: monitor.id,
            policyId: monitor.escalationPolicyId,
          });
        } else {
          alertsEnqueued =
            (await opts.alerts?.dispatch({
              incidentId,
              organizationId: monitor.organizationId,
              monitorId: monitor.id,
              kind: "opened",
            })) ?? 0;
        }
        opts.logger?.warn({ monitorId: monitor.id, incidentId, alertsEnqueued }, "monitor down");
      }
    }
  } else if (decision.incident === "resolve") {
    incidentId = await resolveIncident(prisma, monitor.id, now);
    if (incidentId) {
      pipelineTransition = "recovered";
      await writeAudit(prisma, {
        organizationId: monitor.organizationId,
        actorType: "system",
        action: "incident.resolved",
        resourceType: "incident",
        resourceId: incidentId,
        metadata: { monitorId: monitor.id, region: opts.region },
      });
      alertsEnqueued =
        (await opts.alerts?.dispatch({
          incidentId,
          organizationId: monitor.organizationId,
          monitorId: monitor.id,
          kind: "resolved",
        })) ?? 0;
      opts.logger?.info({ monitorId: monitor.id, incidentId, alertsEnqueued }, "monitor recovered");
    }
  } else if (decision.changed && decision.state === "DOWN") {
    // RECOVERING → DOWN: the open incident persists; note the relapse.
    incidentId = await findOpenIncidentId(prisma, monitor.id);
    if (incidentId) {
      await addEvent(prisma, incidentId, "STATUS_CHANGED", "Still failing during recovery.", now);
    }
  }

  return {
    checkStatus: status,
    previousHealth: monitor.health,
    newHealth: decision.state,
    state: decision.state,
    transition: pipelineTransition,
    inMaintenance,
    flapping,
    incidentId,
    alertsEnqueued,
  };
}

/**
 * Ingest a heartbeat ping (push-based). Records an UP check, stamps the ping
 * time, and recovers the monitor if it had gone overdue. Returns null when the
 * monitor doesn't exist or isn't a heartbeat.
 */
export async function recordHeartbeat(
  prisma: PrismaClient,
  monitorId: string,
  opts: { now?: Date; region?: ProbeRegion; alerts?: AlertDispatcher; logger?: PipelineLogger } = {},
): Promise<ProcessResult | null> {
  const now = opts.now ?? new Date();
  const row = await prisma.monitor.findFirst({
    where: { id: monitorId, type: "HEARTBEAT", deletedAt: null },
    include: { assertions: true },
  });
  if (!row) return null;

  const outcome: ProbeOutcome = { status: "UP", responseMs: 0, validations: [], attempts: 1 };
  return processCheckResult(prisma, toSnapshot(row as MonitorRow), outcome, {
    region: opts.region ?? DEFAULT_REGION,
    now,
    isHeartbeatPing: true,
    alerts: opts.alerts,
    logger: opts.logger,
  });
}
