import type { Job } from "bullmq";
import type { PrismaClient } from "@backend-uptime/db";
import type { AlertDispatcher } from "./alerting/dispatcher.js";
import type { IntegrationDispatcher } from "./integrations/dispatcher.js";
import type { EscalationStarter } from "./escalation/engine.js";
import { executeCheck } from "./execute.js";
import { processCheckResult, toSnapshot, type MonitorRow, type PipelineLogger } from "./pipeline.js";
import { defaultProbes } from "./probes/index.js";
import type { CheckJobData, ProbeRegistry } from "./types.js";

export interface ProcessorLogger extends PipelineLogger {
  error(payload: Record<string, unknown>, message: string): void;
}

export interface CheckProcessorDeps {
  prisma: PrismaClient;
  probes?: ProbeRegistry;
  /** Optional alert fan-out, passed through to the result pipeline. */
  alerts?: AlertDispatcher;
  /** Optional integration fan-out (Slack/Discord/webhooks), passed through. */
  integrations?: IntegrationDispatcher;
  /** Optional escalation engine, passed through to the result pipeline. */
  escalation?: EscalationStarter;
  logger?: ProcessorLogger;
}

export interface CheckJobResult {
  monitorId: string;
  skipped?: "not_found" | "inactive" | "unsupported_type";
  status?: string;
  transition?: "down" | "recovered" | null;
}

/**
 * BullMQ processor for the monitor-check queue. Loads the monitor fresh (so
 * config edits take effect next tick), runs its probe with retries, then hands
 * the outcome to the result-processing pipeline. Throwing surfaces the job to
 * BullMQ's retry/backoff; expected no-ops (deleted/paused monitor) return a
 * skip marker instead of throwing.
 */
export function createCheckProcessor(deps: CheckProcessorDeps) {
  const probes = deps.probes ?? defaultProbes;

  return async (job: Job<CheckJobData>): Promise<CheckJobResult> => {
    const { monitorId, region } = job.data;

    const row = await deps.prisma.monitor.findFirst({
      where: { id: monitorId, deletedAt: null },
      include: { assertions: true },
    });
    if (!row) return { monitorId, skipped: "not_found" };
    if (row.state !== "ACTIVE") return { monitorId, skipped: "inactive" };

    const probe = probes[row.type];
    if (!probe) {
      deps.logger?.error({ monitorId, type: row.type }, "no probe for monitor type");
      return { monitorId, skipped: "unsupported_type" };
    }

    const monitor = toSnapshot(row as MonitorRow);
    const outcome = await executeCheck(monitor, probe);
    const result = await processCheckResult(deps.prisma, monitor, outcome, {
      region,
      alerts: deps.alerts,
      integrations: deps.integrations,
      escalation: deps.escalation,
      logger: deps.logger,
    });

    deps.logger?.info(
      {
        monitorId,
        region,
        status: outcome.status,
        attempts: outcome.attempts,
        transition: result.transition,
      },
      "check processed",
    );

    return { monitorId, status: outcome.status, transition: result.transition };
  };
}
