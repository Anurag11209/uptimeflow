import type { AssertionComparator } from "@backend-uptime/db";
import type { AssertionDef, MonitorSnapshot, ProbeSignal, ValidationResult } from "./types.js";

/** Default cert-expiry warning window when no explicit assertion is set. */
export const DEFAULT_SSL_WARN_DAYS = 14;

/**
 * Apply one comparator. Returns whether the assertion HOLDS (true = passing).
 * Numeric comparators coerce both sides; the rest operate on strings.
 */
export function applyComparator(
  actual: string | number | undefined | null,
  comparator: AssertionComparator,
  expected: string,
): boolean {
  const exists = actual !== undefined && actual !== null && actual !== "";

  switch (comparator) {
    case "EXISTS":
      return exists;
    case "EQUALS":
      return exists && String(actual) === expected;
    case "NOT_EQUALS":
      return String(actual) !== expected;
    case "CONTAINS":
      return exists && String(actual).includes(expected);
    case "NOT_CONTAINS":
      return !String(actual ?? "").includes(expected);
    case "GREATER_THAN":
      return exists && Number(actual) > Number(expected);
    case "LESS_THAN":
      return exists && Number(actual) < Number(expected);
    case "MATCHES_REGEX":
      try {
        return exists && new RegExp(expected).test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Minimal dot/index path getter for BODY_JSON assertions (e.g. "data.items.0.id"). */
function readJsonPath(body: string | undefined, path: string): string | number | undefined {
  if (!body) return undefined;
  let node: unknown;
  try {
    node = JSON.parse(body);
  } catch {
    return undefined;
  }
  for (const segment of path.split(".")) {
    if (node == null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" || typeof node === "number" ? node : node == null ? undefined : JSON.stringify(node);
}

/** The observed value a custom assertion compares against. */
function resolveActual(def: AssertionDef, signal: ProbeSignal): string | number | undefined {
  switch (def.source) {
    case "STATUS_CODE":
      return signal.statusCode;
    case "RESPONSE_TIME":
      return signal.responseMs;
    case "HEADER":
      return def.property ? signal.headers?.[def.property.toLowerCase()] : undefined;
    case "BODY_TEXT":
      return signal.body;
    case "BODY_JSON":
      return def.property ? readJsonPath(signal.body, def.property) : undefined;
    case "SSL_EXPIRY_DAYS":
      return signal.cert?.daysUntilExpiry;
    default:
      return undefined; // DNS_RECORD and friends are evaluated by their probe
  }
}

/**
 * Validate a reachable probe signal against the monitor's configuration and its
 * custom assertions. Returns only the VIOLATIONS (passing checks are omitted):
 *   • severity "error" → the check is DOWN
 *   • severity "warn"  → the check is DEGRADED
 */
export function evaluateValidations(monitor: MonitorSnapshot, signal: ProbeSignal): ValidationResult[] {
  const violations: ValidationResult[] = [];

  // 1. Expected HTTP status code.
  if (monitor.expectedStatus != null && signal.statusCode != null) {
    if (signal.statusCode !== monitor.expectedStatus) {
      violations.push({
        ok: false,
        severity: "error",
        code: "status_mismatch",
        message: `Expected status ${monitor.expectedStatus}, got ${signal.statusCode}.`,
      });
    }
  }

  // 2. Keyword presence / absence.
  if (monitor.keyword) {
    const present = (signal.body ?? "").includes(monitor.keyword);
    const satisfied = monitor.keywordInverted ? !present : present;
    if (!satisfied) {
      violations.push({
        ok: false,
        severity: "error",
        code: "keyword",
        message: monitor.keywordInverted
          ? `Forbidden keyword "${monitor.keyword}" was present.`
          : `Required keyword "${monitor.keyword}" was missing.`,
      });
    }
  }

  // 3. SSL expiry (when a cert was captured). Explicit SSL_EXPIRY_DAYS
  //    assertions are handled in the custom-assertion loop below; this is the
  //    default safety net: expired → DOWN, near-expiry → DEGRADED.
  if (signal.cert && !monitor.assertions.some((a) => a.source === "SSL_EXPIRY_DAYS")) {
    const days = signal.cert.daysUntilExpiry;
    if (days <= 0) {
      violations.push({
        ok: false,
        severity: "error",
        code: "ssl_expired",
        message: `TLS certificate expired ${Math.abs(days)} day(s) ago.`,
      });
    } else if (days < DEFAULT_SSL_WARN_DAYS) {
      violations.push({
        ok: false,
        severity: "warn",
        code: "ssl_expiring",
        message: `TLS certificate expires in ${days} day(s).`,
      });
    }
  }

  // 4. Custom assertions. A failed assertion is an error unless it only warns
  //    on a soft signal (response time / ssl expiry), which degrades instead.
  for (const def of monitor.assertions) {
    const actual = resolveActual(def, signal);
    if (applyComparator(actual, def.comparator, def.expected)) continue;
    const soft = def.source === "RESPONSE_TIME" || def.source === "SSL_EXPIRY_DAYS";
    violations.push({
      ok: false,
      severity: soft ? "warn" : "error",
      code: `assert_${def.source.toLowerCase()}`,
      message: `Assertion failed: ${def.source} ${def.comparator} ${def.expected} (actual: ${actual ?? "n/a"}).`,
    });
  }

  return violations;
}
