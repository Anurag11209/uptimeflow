import type { CheckStatus } from "@backend-uptime/db";
import { evaluateValidations } from "./assertions.js";
import type {
  MonitorSnapshot,
  Probe,
  ProbeOutcome,
  ProbeSignal,
  ValidationResult,
} from "./types.js";

/** Backoff between in-check retries. */
export const RETRY_BACKOFF_MS = 500;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Map an unreachable signal's failure bucket to a CheckStatus. */
function statusForUnreachable(errorType: string | undefined): CheckStatus {
  if (errorType === "timeout") return "TIMEOUT";
  if (errorType === "config" || errorType === "error") return "ERROR";
  return "DOWN"; // dns / connect / refused / tls / no_ping
}

/**
 * Classify a single probe signal into an outcome by running validations:
 *   unreachable          → DOWN / TIMEOUT / ERROR
 *   reachable + error    → DOWN  (status/keyword/assertion failure)
 *   reachable + warn     → DEGRADED (slow / cert near expiry)
 *   reachable + clean    → UP
 */
export function classifySignal(monitor: MonitorSnapshot, signal: ProbeSignal): Omit<ProbeOutcome, "attempts"> {
  if (!signal.reachable) {
    return {
      status: statusForUnreachable(signal.errorType),
      responseMs: signal.responseMs,
      errorType: signal.errorType,
      errorMessage: signal.errorMessage,
      validations: [],
    };
  }

  const validations: ValidationResult[] = evaluateValidations(monitor, signal);
  const hasError = validations.some((v) => v.severity === "error");
  const hasWarn = validations.some((v) => v.severity === "warn");
  const status: CheckStatus = hasError ? "DOWN" : hasWarn ? "DEGRADED" : "UP";

  return {
    status,
    statusCode: signal.statusCode,
    responseMs: signal.responseMs,
    cert: signal.cert,
    errorType: hasError ? "assert" : undefined,
    errorMessage: hasError ? validations.find((v) => v.severity === "error")?.message : undefined,
    validations,
  };
}

const isSuccess = (status: CheckStatus): boolean => status === "UP" || status === "DEGRADED";

/**
 * Run one full check: execute the probe and, on failure, retry up to
 * `monitor.retries` times (with backoff) before accepting a failing outcome. A
 * successful (UP/DEGRADED) attempt short-circuits the retries. These are
 * in-check retries, distinct from BullMQ's job-level retries for infra errors.
 */
export async function executeCheck(
  monitor: MonitorSnapshot,
  probe: Probe,
  now: Date = new Date(),
): Promise<ProbeOutcome> {
  let outcome: Omit<ProbeOutcome, "attempts"> | undefined;
  let attempts = 0;

  for (let attempt = 0; attempt <= monitor.retries; attempt++) {
    attempts = attempt + 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), monitor.timeoutSeconds * 1000);
    try {
      const signal = await probe(monitor, { signal: controller.signal, now });
      outcome = classifySignal(monitor, signal);
    } finally {
      clearTimeout(timer);
    }

    if (isSuccess(outcome.status)) break;
    if (attempt < monitor.retries) await sleep(RETRY_BACKOFF_MS);
  }

  return { ...outcome!, attempts };
}
