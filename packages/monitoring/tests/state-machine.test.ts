import { describe, expect, it } from "vitest";
import type { MonitorHealth } from "@backend-uptime/db";
import { transition, type TransitionInput } from "../src/state-machine.js";

function input(over: Partial<TransitionInput>): TransitionInput {
  return {
    current: "UP" as MonitorHealth,
    success: true,
    priorConsecutiveFailures: 0,
    priorConsecutiveSuccesses: 0,
    failureThreshold: 1,
    successThreshold: 1,
    inMaintenance: false,
    ...over,
  };
}

describe("monitor state machine", () => {
  it("PENDING → UP on first success", () => {
    const r = transition(input({ current: "PENDING", success: true }));
    expect(r.state).toBe("UP");
    expect(r.incident).toBeNull();
  });

  it("holds UP under the failure threshold, then trips to DOWN with an incident", () => {
    const below = transition(input({ current: "UP", success: false, priorConsecutiveFailures: 0, failureThreshold: 2 }));
    expect(below.state).toBe("UP");
    expect(below.consecutiveFailures).toBe(1);
    expect(below.incident).toBeNull();

    const tripped = transition(input({ current: "UP", success: false, priorConsecutiveFailures: 1, failureThreshold: 2 }));
    expect(tripped.state).toBe("DOWN");
    expect(tripped.consecutiveFailures).toBe(2);
    expect(tripped.incident).toBe("open");
    expect(tripped.changed).toBe(true);
  });

  it("DOWN → RECOVERING on a success below the success threshold", () => {
    const r = transition(input({ current: "DOWN", success: true, priorConsecutiveSuccesses: 0, successThreshold: 2 }));
    expect(r.state).toBe("RECOVERING");
    expect(r.incident).toBeNull();
  });

  it("RECOVERING → UP once the success threshold is met, resolving the incident", () => {
    const r = transition(input({ current: "RECOVERING", success: true, priorConsecutiveSuccesses: 1, successThreshold: 2 }));
    expect(r.state).toBe("UP");
    expect(r.incident).toBe("resolve");
  });

  it("RECOVERING → DOWN on a relapse without opening a new incident", () => {
    const r = transition(input({ current: "RECOVERING", success: false }));
    expect(r.state).toBe("DOWN");
    expect(r.incident).toBeNull(); // incident already open
    expect(r.consecutiveSuccesses).toBe(0);
  });

  it("maintenance forces MAINTENANCE and suppresses incidents", () => {
    const r = transition(input({ current: "UP", success: false, inMaintenance: true, failureThreshold: 1 }));
    expect(r.state).toBe("MAINTENANCE");
    expect(r.incident).toBeNull();
  });

  it("recovers cleanly when leaving maintenance", () => {
    const r = transition(input({ current: "MAINTENANCE", success: true }));
    expect(r.state).toBe("UP");
    expect(r.incident).toBe("resolve"); // no-op if nothing was open
  });

  it("resets the opposing counter on each check", () => {
    const afterSuccess = transition(input({ current: "UP", success: true, priorConsecutiveFailures: 3 }));
    expect(afterSuccess.consecutiveFailures).toBe(0);
    expect(afterSuccess.consecutiveSuccesses).toBe(1);
  });
});
