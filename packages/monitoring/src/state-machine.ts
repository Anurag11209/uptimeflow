import type { MonitorHealth } from "@backend-uptime/db";

/**
 * The five canonical monitor states. A subset of the Prisma `MonitorHealth`
 * enum (DEGRADED/PAUSED are display nuances handled outside the core machine).
 *
 *   PENDING      never confirmed either way (initial)
 *   UP           passing
 *   DOWN         confirmed failing (>= failureThreshold consecutive failures)
 *   RECOVERING   was DOWN, now passing but < successThreshold successes
 *   MAINTENANCE  inside an active maintenance window (transitions suppressed)
 */
export type MonitorState = "PENDING" | "UP" | "DOWN" | "RECOVERING" | "MAINTENANCE";

/** Whether a transition should open or resolve an incident (or neither). */
export type IncidentAction = "open" | "resolve" | null;

export interface TransitionInput {
  /** Current persisted health. */
  current: MonitorHealth;
  /** Did this check succeed (UP/DEGRADED outcome)? */
  success: boolean;
  /** Consecutive counters BEFORE applying this check. */
  priorConsecutiveFailures: number;
  priorConsecutiveSuccesses: number;
  /** Confirmation thresholds from the monitor config. */
  failureThreshold: number;
  successThreshold: number;
  /** Inside an active, alert-suppressing maintenance window? */
  inMaintenance: boolean;
}

export interface TransitionResult {
  state: MonitorState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  /** Incident side effect implied by this transition (attempted; idempotent). */
  incident: IncidentAction;
  /** True when `state` differs from the (normalized) prior state. */
  changed: boolean;
}

/** Collapse the persisted enum onto the five canonical states. */
function normalize(current: MonitorHealth): MonitorState {
  switch (current) {
    case "DOWN":
    case "RECOVERING":
    case "PENDING":
    case "MAINTENANCE":
      return current;
    default:
      // UP, DEGRADED, PAUSED, and any future value behave like UP here.
      return "UP";
  }
}

function incidentAction(prev: MonitorState, next: MonitorState): IncidentAction {
  // Open only when entering DOWN from a state with no open incident.
  if (next === "DOWN" && prev !== "DOWN" && prev !== "RECOVERING") return "open";
  // Resolve when fully recovered to UP from a degraded/suppressed state. The
  // pipeline no-ops the resolve if no incident is actually open (e.g. a clean
  // exit from MAINTENANCE), so emitting it here is safe.
  if (next === "UP" && (prev === "DOWN" || prev === "RECOVERING" || prev === "MAINTENANCE")) {
    return "resolve";
  }
  return null;
}

/**
 * Pure monitor state-machine transition. Given the current state, the check
 * outcome, and the confirmation thresholds, it computes the next state, the new
 * consecutive counters, and the implied incident action. No I/O — the pipeline
 * performs the persistence and incident/alert side effects.
 */
export function transition(input: TransitionInput): TransitionResult {
  const prev = normalize(input.current);
  const failure = !input.success;

  const consecutiveFailures = failure ? input.priorConsecutiveFailures + 1 : 0;
  const consecutiveSuccesses = input.success ? input.priorConsecutiveSuccesses + 1 : 0;

  const failureConfirmed = consecutiveFailures >= input.failureThreshold;
  const successConfirmed = consecutiveSuccesses >= input.successThreshold;

  let next: MonitorState;

  if (input.inMaintenance) {
    next = "MAINTENANCE";
  } else {
    switch (prev) {
      case "PENDING":
        next = input.success ? "UP" : failureConfirmed ? "DOWN" : "PENDING";
        break;
      case "DOWN":
      case "RECOVERING":
        // A failure (re)confirms DOWN; a success climbs toward recovery.
        next = !input.success ? "DOWN" : successConfirmed ? "UP" : "RECOVERING";
        break;
      case "MAINTENANCE":
        // Leaving maintenance: optimistic unless failures cross the threshold.
        next = input.success ? "UP" : failureConfirmed ? "DOWN" : "UP";
        break;
      case "UP":
      default:
        next = input.success ? "UP" : failureConfirmed ? "DOWN" : "UP";
        break;
    }
  }

  return {
    state: next,
    consecutiveFailures,
    consecutiveSuccesses,
    incident: incidentAction(prev, next),
    changed: next !== prev,
  };
}
