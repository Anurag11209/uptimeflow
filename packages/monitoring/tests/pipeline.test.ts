import { describe, expect, it } from "vitest";
import { processCheckResult, recordHeartbeat } from "../src/pipeline.js";
import type { ProbeOutcome } from "../src/index.js";
import { mockPrisma, snap, spyDispatcher } from "./fixtures.js";

const down: ProbeOutcome = { status: "DOWN", responseMs: 0, errorType: "connect", errorMessage: "refused", validations: [], attempts: 1 };
const up: ProbeOutcome = { status: "UP", statusCode: 200, responseMs: 80, validations: [], attempts: 1 };

const REGION = "NA_EAST" as const;

describe("result pipeline — health state machine", () => {
  it("always records the raw check result with the org id", async () => {
    const { prisma, writes } = mockPrisma();
    await processCheckResult(prisma, snap(), up, { region: REGION });
    expect(writes.checkResults).toHaveLength(1);
    expect(writes.checkResults[0]).toMatchObject({ organizationId: "org_1", status: "UP", region: REGION });
  });

  it("holds UP below the failure threshold (no incident)", async () => {
    const { prisma, writes } = mockPrisma();
    const r = await processCheckResult(
      prisma,
      snap({ health: "UP", failureThreshold: 2, consecutiveFailures: 0 }),
      down,
      { region: REGION },
    );
    expect(r.transition).toBeNull();
    expect(r.newHealth).toBe("UP");
    expect(writes.incidentCreates).toHaveLength(0);
  });

  it("opens an incident, audits it, and dispatches an alert on a DOWN transition", async () => {
    const { prisma, writes } = mockPrisma();
    const { alerts, calls } = spyDispatcher();
    const r = await processCheckResult(
      prisma,
      snap({ health: "UP", failureThreshold: 2, consecutiveFailures: 1 }),
      down,
      { region: REGION, alerts },
    );
    expect(r.transition).toBe("down");
    expect(r.newHealth).toBe("DOWN");
    expect(writes.incidentCreates[0]).toMatchObject({ status: "OPEN", fingerprint: "mon_1:down" });
    expect(writes.audits[0]).toMatchObject({ action: "incident.opened", actorType: "system" });
    expect(calls).toEqual([
      { incidentId: "inc_1", organizationId: "org_1", monitorId: "mon_1", kind: "opened" },
    ]);
    expect(r.alertsEnqueued).toBe(1);
  });

  it("goes DOWN → RECOVERING below the success threshold, then UP resolves it", async () => {
    const openIncident = { id: "inc_1", startedAt: new Date(Date.now() - 60_000) };

    const recovering = mockPrisma({ openIncident });
    const r1 = await processCheckResult(
      recovering.prisma,
      snap({ health: "DOWN", successThreshold: 2, consecutiveSuccesses: 0 }),
      up,
      { region: REGION },
    );
    expect(r1.newHealth).toBe("RECOVERING");
    expect(r1.transition).toBeNull();
    expect(recovering.writes.incidentUpdates).toHaveLength(0);

    const recovered = mockPrisma({ openIncident });
    const { alerts, calls } = spyDispatcher();
    const r2 = await processCheckResult(
      recovered.prisma,
      snap({ health: "RECOVERING", successThreshold: 2, consecutiveSuccesses: 1 }),
      up,
      { region: REGION, alerts },
    );
    expect(r2.newHealth).toBe("UP");
    expect(r2.transition).toBe("recovered");
    expect(recovered.writes.incidentUpdates[0]?.data).toMatchObject({ status: "RESOLVED", fingerprint: null });
    expect(recovered.writes.audits[0]).toMatchObject({ action: "incident.resolved" });
    expect(calls[0]).toMatchObject({ kind: "resolved" });
  });

  it("records a relapse timeline event when RECOVERING falls back to DOWN", async () => {
    const { prisma, writes } = mockPrisma({ openIncident: { id: "inc_1", startedAt: new Date() } });
    const r = await processCheckResult(prisma, snap({ health: "RECOVERING" }), down, { region: REGION });
    expect(r.newHealth).toBe("DOWN");
    expect(r.transition).toBeNull(); // no new incident opened
    expect(writes.incidentCreates).toHaveLength(0);
    expect(writes.incidentEvents.some((e) => e.type === "STATUS_CHANGED")).toBe(true);
  });

  it("suppresses incidents during a maintenance window", async () => {
    const { prisma, writes } = mockPrisma({ maintenance: true });
    const { alerts, calls } = spyDispatcher();
    const r = await processCheckResult(prisma, snap({ health: "UP", failureThreshold: 1 }), down, {
      region: REGION,
      alerts,
    });
    expect(r.inMaintenance).toBe(true);
    expect(r.newHealth).toBe("MAINTENANCE");
    expect(r.transition).toBeNull();
    expect(writes.incidentCreates).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe("alert deduplication — flapping", () => {
  it("records the incident but suppresses the alert when flapping", async () => {
    const { prisma, writes } = mockPrisma({ incidentCount: 5 }); // >= FLAP_THRESHOLD
    const { alerts, calls } = spyDispatcher();
    const r = await processCheckResult(prisma, snap({ health: "UP", failureThreshold: 1 }), down, {
      region: REGION,
      alerts,
    });
    expect(r.flapping).toBe(true);
    expect(writes.incidentCreates).toHaveLength(1); // still tracked
    expect(calls).toHaveLength(0); // alert deduplicated
    expect(writes.audits[0]).toMatchObject({ action: "monitor.flapping" });
    expect(writes.incidentEvents.some((e) => e.metadata && (e.metadata as { flapping?: boolean }).flapping)).toBe(true);
  });

  it("alerts normally when not flapping", async () => {
    const { prisma } = mockPrisma({ incidentCount: 1 });
    const { alerts, calls } = spyDispatcher();
    await processCheckResult(prisma, snap({ health: "UP", failureThreshold: 1 }), down, { region: REGION, alerts });
    expect(calls).toHaveLength(1);
  });
});

describe("heartbeat handling", () => {
  it("does not stamp lastCheckedAt on a scheduled freshness eval", async () => {
    const { prisma, writes } = mockPrisma();
    await processCheckResult(prisma, snap({ type: "HEARTBEAT" }), down, { region: REGION });
    expect(writes.monitorUpdates[0]).not.toHaveProperty("lastCheckedAt");
  });

  it("recordHeartbeat stamps the ping time and recovers an overdue monitor", async () => {
    const row = {
      id: "mon_1",
      organizationId: "org_1",
      name: "Cron",
      type: "HEARTBEAT",
      url: null,
      host: null,
      port: null,
      httpMethod: null,
      requestHeaders: null,
      requestBody: null,
      expectedStatus: null,
      keyword: null,
      keywordInverted: false,
      followRedirects: false,
      verifySsl: false,
      timeoutSeconds: 30,
      retries: 0,
      intervalSeconds: 300,
      failureThreshold: 1,
      successThreshold: 1,
      health: "DOWN",
      consecutiveFailures: 3,
      consecutiveSuccesses: 0,
      lastCheckedAt: null,
      assertions: [],
    };
    const { prisma, writes } = mockPrisma({
      monitorRow: row,
      openIncident: { id: "inc_1", startedAt: new Date(Date.now() - 120_000) },
    });

    const result = await recordHeartbeat(prisma, "mon_1");
    expect(result?.transition).toBe("recovered");
    expect(writes.monitorUpdates[0]).toHaveProperty("lastCheckedAt");
    expect(writes.checkResults[0]).toMatchObject({ status: "UP" });
  });

  it("recordHeartbeat returns null for an unknown monitor", async () => {
    const { prisma } = mockPrisma({ monitorRow: null });
    expect(await recordHeartbeat(prisma, "missing")).toBeNull();
  });
});
