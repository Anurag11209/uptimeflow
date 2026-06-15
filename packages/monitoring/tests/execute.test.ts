import { describe, expect, it } from "vitest";
import { classifySignal, executeCheck } from "../src/execute.js";
import type { Probe, ProbeSignal } from "../src/index.js";
import { snap } from "./fixtures.js";

describe("classifySignal", () => {
  it("maps unreachable signals to a failure status", () => {
    expect(classifySignal(snap(), { reachable: false, responseMs: 0, errorType: "timeout" }).status).toBe("TIMEOUT");
    expect(classifySignal(snap(), { reachable: false, responseMs: 0, errorType: "dns" }).status).toBe("DOWN");
    expect(classifySignal(snap(), { reachable: false, responseMs: 0, errorType: "config" }).status).toBe("ERROR");
  });

  it("returns UP for a clean reachable response", () => {
    const out = classifySignal(snap(), { reachable: true, responseMs: 100, statusCode: 200, body: "" });
    expect(out.status).toBe("UP");
  });

  it("returns DOWN when a hard validation fails", () => {
    const out = classifySignal(snap({ expectedStatus: 200 }), { reachable: true, responseMs: 50, statusCode: 500 });
    expect(out.status).toBe("DOWN");
    expect(out.errorType).toBe("assert");
  });

  it("returns DEGRADED for a soft (warn) violation only", () => {
    const certSig: ProbeSignal = {
      reachable: true,
      responseMs: 50,
      statusCode: 200,
      cert: { validTo: new Date(), validFrom: new Date(0), daysUntilExpiry: 5, issuer: null, subject: null },
    };
    expect(classifySignal(snap(), certSig).status).toBe("DEGRADED");
  });
});

describe("executeCheck retries", () => {
  function countingProbe(results: ProbeSignal[]): { probe: Probe; calls: () => number } {
    let i = 0;
    const probe: Probe = async () => results[Math.min(i++, results.length - 1)]!;
    return { probe, calls: () => i };
  }

  const ok: ProbeSignal = { reachable: true, responseMs: 10, statusCode: 200, body: "" };
  const fail: ProbeSignal = { reachable: false, responseMs: 0, errorType: "connect", errorMessage: "refused" };

  it("does not retry a first-attempt success", async () => {
    const { probe, calls } = countingProbe([ok]);
    const out = await executeCheck(snap({ retries: 2 }), probe);
    expect(out.status).toBe("UP");
    expect(out.attempts).toBe(1);
    expect(calls()).toBe(1);
  });

  it("retries failures up to `retries` then succeeds", async () => {
    const { probe, calls } = countingProbe([fail, fail, ok]);
    const out = await executeCheck(snap({ retries: 2 }), probe);
    expect(out.status).toBe("UP");
    expect(out.attempts).toBe(3);
    expect(calls()).toBe(3);
  });

  it("gives up as DOWN after exhausting retries", async () => {
    const { probe } = countingProbe([fail]);
    const out = await executeCheck(snap({ retries: 1 }), probe);
    expect(out.status).toBe("DOWN");
    expect(out.attempts).toBe(2);
  });
});
