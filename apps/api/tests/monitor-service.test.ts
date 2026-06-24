import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import { createMonitorService, type MonitorActor } from "../src/services/monitor.service.js";
import type { AuditLogService } from "../src/services/audit-log.service.js";
import type { PlanLimitsService } from "../src/services/plan-limits.service.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const actor: MonitorActor = { userId: "user_1", actorType: "user" };

/** A complete monitor row as returned by the DETAIL_SELECT query. */
const mockRow = {
  id: "mon_1",
  name: "Test Monitor",
  type: "HTTP" as const,
  state: "ACTIVE" as const,
  health: "UP" as const,
  url: "https://example.com",
  host: null,
  port: null,
  intervalSeconds: 60,
  groupId: null,
  group: null,
  lastCheckedAt: null,
  lastResponseMs: null,
  lastStatusCode: null,
  lastError: null,
  escalationPolicyId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  httpMethod: "GET" as const,
  requestHeaders: null,
  requestBody: null,
  expectedStatus: 200,
  keyword: null,
  keywordInverted: false,
  followRedirects: true,
  verifySsl: true,
  timeoutSeconds: 30,
  retries: 2,
  regions: ["NA_EAST"] as const,
  failureThreshold: 1,
  successThreshold: 1,
  consecutiveFailures: 0,
  consecutiveSuccesses: 0,
  assertions: [],
  channels: [],
};

// ─── Fake deps ────────────────────────────────────────────────────────────────

const fakeAuditLogs: AuditLogService = {
  log: vi.fn(async () => {}),
} as unknown as AuditLogService;

/** Plan limits that always pass. */
function passingLimits(): PlanLimitsService {
  return {
    assertWithinLimit: vi.fn(async () => {}),
    assertCapability: vi.fn(async () => {}),
  } as unknown as PlanLimitsService;
}

/** Plan limits that reject monitor creation. */
function failingMonitorLimit(): PlanLimitsService {
  return {
    assertWithinLimit: vi.fn(async () => {
      throw Object.assign(new Error("PAYMENT_REQUIRED"), { statusCode: 402 });
    }),
    assertCapability: vi.fn(async () => {}),
  } as unknown as PlanLimitsService;
}

/**
 * Builds a fake PrismaClient with sensible defaults for monitor service tests.
 * Override individual methods as needed per test.
 */
function makeP(
  overrides: {
    monitorFindFirst?: unknown;
    monitorCreate?: unknown;
    monitorUpdateCount?: number;
    groupCount?: number;
    policyCount?: number;
    channelCount?: number;
    checkResults?: unknown[];
    maintenanceWindows?: unknown[];
  } = {},
): PrismaClient {
  const findFirstResult = "monitorFindFirst" in overrides ? overrides.monitorFindFirst : mockRow;

  return {
    monitorGroup: {
      count: vi.fn(async () => overrides.groupCount ?? 1),
    },
    escalationPolicy: {
      count: vi.fn(async () => overrides.policyCount ?? 1),
    },
    alertChannel: {
      // Return the number of IDs requested so assertChannelsOwned always passes
      // by default (count === channelIds.length). Override channelCount to 0
      // in tests that specifically want the ownership check to fail.
      count: vi.fn(async (args: any) =>
        overrides.channelCount !== undefined
          ? overrides.channelCount
          : (args?.where?.id?.in?.length ?? 1),
      ),
    },
    monitor: {
      findFirst: vi.fn(async () => findFirstResult),
      findMany: vi.fn(async () => (findFirstResult ? [findFirstResult] : [])),
      create: vi.fn(async (args: any) => ({
        ...mockRow,
        ...args.data,
        id: "mon_new",
        assertions: args.data.assertions?.create ?? [],
        channels: args.data.channels?.create ?? [],
      })),
      update: vi.fn(async () => findFirstResult),
      updateMany: vi.fn(async () => ({
        count: overrides.monitorUpdateCount ?? 1,
      })),
    },
    monitorAssertion: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    monitorChannel: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
    checkResult: {
      findMany: vi.fn(async () => overrides.checkResults ?? []),
    },
    maintenanceWindow: {
      findMany: vi.fn(async () => overrides.maintenanceWindows ?? []),
    },
  } as unknown as PrismaClient;
}

function makeService(prisma = makeP(), limits = passingLimits()) {
  return createMonitorService({ prisma, auditLogs: fakeAuditLogs, planLimits: limits });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => vi.clearAllMocks());

// ── create: target-field validation ──────────────────────────────────────────

describe("create — target-field validation", () => {
  it("throws URL_REQUIRED for HTTP without url", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "HTTP" }, actor)).rejects.toThrow(
      "URL_REQUIRED",
    );
  });

  it("throws URL_REQUIRED for KEYWORD without url", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "KEYWORD" }, actor)).rejects.toThrow(
      "URL_REQUIRED",
    );
  });

  it("throws URL_REQUIRED for SSL without url", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "SSL" }, actor)).rejects.toThrow(
      "URL_REQUIRED",
    );
  });

  it("throws HOST_REQUIRED for TCP without host", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "TCP", port: 80 }, actor)).rejects.toThrow(
      "HOST_REQUIRED",
    );
  });

  it("throws PORT_REQUIRED for TCP without port", async () => {
    const svc = makeService({} as any);
    await expect(
      svc.create("org_1", { name: "T", type: "TCP", host: "db.example.com" }, actor),
    ).rejects.toThrow("PORT_REQUIRED");
  });

  it("throws HOST_REQUIRED for PING without host", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "PING" }, actor)).rejects.toThrow(
      "HOST_REQUIRED",
    );
  });

  it("throws UNSUPPORTED_TYPE for DNS", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "DNS" as any }, actor)).rejects.toThrow(
      "UNSUPPORTED_TYPE",
    );
  });

  it("throws UNSUPPORTED_TYPE for GRPC", async () => {
    const svc = makeService({} as any);
    await expect(svc.create("org_1", { name: "T", type: "GRPC" as any }, actor)).rejects.toThrow(
      "UNSUPPORTED_TYPE",
    );
  });

  it("HEARTBEAT succeeds with no target fields", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    const result = await svc.create("org_1", { name: "Cron", type: "HEARTBEAT" }, actor);
    expect(result).toMatchObject({ id: "mon_new" });
    expect(prisma.monitor.create).toHaveBeenCalledOnce();
  });
});

// ── create: plan limit enforcement ───────────────────────────────────────────

describe("create — plan limit enforcement", () => {
  it("propagates rejection when the monitor limit is reached", async () => {
    const limits = failingMonitorLimit();
    const svc = makeService({} as any, limits);
    await expect(svc.create("org_1", { name: "T", type: "HEARTBEAT" }, actor)).rejects.toThrow();
    expect(limits.assertWithinLimit).toHaveBeenCalledWith("org_1", "monitor");
  });

  it("calls assertWithinLimit before any prisma write", async () => {
    const limits = failingMonitorLimit();
    const prisma = makeP();
    const svc = makeService(prisma, limits);
    await expect(svc.create("org_1", { name: "T", type: "HEARTBEAT" }, actor)).rejects.toThrow();
    expect(prisma.monitor.create).not.toHaveBeenCalled();
  });
});

// ── create: foreign-key ownership guards ─────────────────────────────────────

describe("create — ownership guards", () => {
  it("throws INVALID_GROUP when groupId belongs to another org", async () => {
    const prisma = makeP({ groupCount: 0 });
    const svc = makeService(prisma);
    await expect(
      svc.create("org_1", { name: "T", type: "HEARTBEAT", groupId: "grp_foreign" }, actor),
    ).rejects.toThrow("INVALID_GROUP");
    expect(prisma.monitor.create).not.toHaveBeenCalled();
  });

  it("throws INVALID_ESCALATION_POLICY when policy belongs to another org", async () => {
    const prisma = makeP({ policyCount: 0 });
    const svc = makeService(prisma);
    await expect(
      svc.create(
        "org_1",
        { name: "T", type: "HEARTBEAT", escalationPolicyId: "pol_foreign" },
        actor,
      ),
    ).rejects.toThrow("INVALID_ESCALATION_POLICY");
    expect(prisma.monitor.create).not.toHaveBeenCalled();
  });

  it("throws INVALID_CHANNEL when a channelId belongs to another org", async () => {
    const prisma = makeP({ channelCount: 0 });
    const svc = makeService(prisma);
    await expect(
      svc.create("org_1", { name: "T", type: "HEARTBEAT", channelIds: ["chan_foreign"] }, actor),
    ).rejects.toThrow("INVALID_CHANNEL");
    expect(prisma.monitor.create).not.toHaveBeenCalled();
  });

  it("creates successfully when a valid groupId is supplied", async () => {
    const prisma = makeP({ groupCount: 1 });
    const svc = makeService(prisma);
    const result = await svc.create(
      "org_1",
      { name: "T", type: "HEARTBEAT", groupId: "grp_own" },
      actor,
    );
    expect(result.id).toBe("mon_new");
    expect(prisma.monitorGroup.count).toHaveBeenCalledOnce();
  });
});

// ── create: audit log ────────────────────────────────────────────────────────

describe("create — audit log", () => {
  it("writes a monitor.created audit log entry", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.create("org_1", { name: "T", type: "HEARTBEAT" }, actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        actorId: "user_1",
        action: "monitor.created",
        resourceType: "monitor",
      }),
    );
  });
});

// ── update: returns null for missing monitor ──────────────────────────────────

describe("update", () => {
  it("returns null when the monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    const result = await svc.update("org_1", "mon_ghost", { name: "X" }, actor);
    expect(result).toBeNull();
  });

  it("validates the merged type+target after a type change", async () => {
    // Existing is HTTP with url but no host/port. Changing type to TCP without
    // providing host should fail because the merged state lacks a host.
    const prisma = makeP();
    const svc = makeService(prisma);
    await expect(svc.update("org_1", "mon_1", { type: "TCP" }, actor)).rejects.toThrow(
      "HOST_REQUIRED",
    );
  });

  it("replaces assertions when assertions is provided", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update(
      "org_1",
      "mon_1",
      { assertions: [{ source: "STATUS_CODE", comparator: "EQUALS", expected: "200" }] },
      actor,
    );
    expect(prisma.monitorAssertion.deleteMany).toHaveBeenCalledWith({
      where: { monitorId: "mon_1" },
    });
    expect(prisma.monitorAssertion.createMany).toHaveBeenCalledOnce();
  });

  it("leaves assertions untouched when assertions is absent from input", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update("org_1", "mon_1", { name: "Renamed" }, actor);
    expect(prisma.monitorAssertion.deleteMany).not.toHaveBeenCalled();
    expect(prisma.monitorAssertion.createMany).not.toHaveBeenCalled();
  });

  it("replaces channel bindings when channelIds is provided", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update("org_1", "mon_1", { channelIds: ["chan_1"] }, actor);
    expect(prisma.monitorChannel.deleteMany).toHaveBeenCalledWith({
      where: { monitorId: "mon_1" },
    });
    expect(prisma.monitorChannel.createMany).toHaveBeenCalledOnce();
  });

  it("leaves channel bindings untouched when channelIds is absent", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update("org_1", "mon_1", { name: "Renamed" }, actor);
    expect(prisma.monitorChannel.deleteMany).not.toHaveBeenCalled();
  });

  it("clears all channels when channelIds is an empty array", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update("org_1", "mon_1", { channelIds: [] }, actor);
    expect(prisma.monitorChannel.deleteMany).toHaveBeenCalled();
    expect(prisma.monitorChannel.createMany).not.toHaveBeenCalled();
  });

  it("writes a monitor.updated audit log entry", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.update("org_1", "mon_1", { name: "New Name" }, actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor.updated", resourceId: "mon_1" }),
    );
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe("remove", () => {
  it("returns false when monitor does not exist", async () => {
    const prisma = makeP({ monitorUpdateCount: 0 });
    const svc = makeService(prisma);
    const result = await svc.remove("org_1", "mon_ghost", actor);
    expect(result).toBe(false);
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("returns true and soft-deletes when monitor exists", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    const result = await svc.remove("org_1", "mon_1", actor);
    expect(result).toBe(true);
    expect(prisma.monitor.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "mon_1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it("writes a monitor.deleted audit log entry", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.remove("org_1", "mon_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor.deleted", resourceId: "mon_1" }),
    );
  });
});

// ── pause ─────────────────────────────────────────────────────────────────────

describe("pause", () => {
  it("returns null when monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    expect(await svc.pause("org_1", "mon_ghost", actor)).toBeNull();
  });

  it("updates state to PAUSED when currently ACTIVE", async () => {
    const prisma = makeP(); // mockRow.state === "ACTIVE"
    const svc = makeService(prisma);
    await svc.pause("org_1", "mon_1", actor);
    expect(prisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: "PAUSED", health: "PAUSED" }),
      }),
    );
  });

  it("is idempotent — skips the DB write when already PAUSED", async () => {
    const prisma = makeP({ monitorFindFirst: { ...mockRow, state: "PAUSED" } });
    const svc = makeService(prisma);
    await svc.pause("org_1", "mon_1", actor);
    expect(prisma.monitor.update).not.toHaveBeenCalled();
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("writes a monitor.paused audit log entry", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.pause("org_1", "mon_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor.paused", resourceId: "mon_1" }),
    );
  });
});

// ── resume ────────────────────────────────────────────────────────────────────

describe("resume", () => {
  it("returns null when monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    expect(await svc.resume("org_1", "mon_ghost", actor)).toBeNull();
  });

  it("updates state to ACTIVE and resets counters when currently PAUSED", async () => {
    const prisma = makeP({ monitorFindFirst: { ...mockRow, state: "PAUSED" } });
    const svc = makeService(prisma);
    await svc.resume("org_1", "mon_1", actor);
    expect(prisma.monitor.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: "ACTIVE",
          health: "PENDING",
          consecutiveFailures: 0,
          consecutiveSuccesses: 0,
        }),
      }),
    );
  });

  it("is idempotent — skips the DB write when already ACTIVE", async () => {
    const prisma = makeP(); // mockRow.state === "ACTIVE"
    const svc = makeService(prisma);
    await svc.resume("org_1", "mon_1", actor);
    expect(prisma.monitor.update).not.toHaveBeenCalled();
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("writes a monitor.resumed audit log entry", async () => {
    const prisma = makeP({ monitorFindFirst: { ...mockRow, state: "PAUSED" } });
    const svc = makeService(prisma);
    await svc.resume("org_1", "mon_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "monitor.resumed", resourceId: "mon_1" }),
    );
  });
});

// ── listCheckResults ──────────────────────────────────────────────────────────

describe("listCheckResults", () => {
  it("returns null when the monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    const result = await svc.listCheckResults("org_1", "mon_ghost", { limit: 50 });
    expect(result).toBeNull();
  });

  it("returns an empty page for a monitor with no results yet", async () => {
    const prisma = makeP({ checkResults: [] });
    const svc = makeService(prisma);
    const result = await svc.listCheckResults("org_1", "mon_1", { limit: 50 });
    expect(result).not.toBeNull();
    expect(result!.items).toHaveLength(0);
    expect(result!.nextCursor).toBeNull();
  });

  it("sets nextCursor when there are more results than the limit", async () => {
    const makeResult = (i: number) => ({
      id: `res_${i}`,
      region: "NA_EAST",
      status: "UP",
      statusCode: 200,
      responseMs: 100,
      errorType: null,
      errorMessage: null,
      checkedAt: new Date(Date.now() - i * 1000),
    });
    // Return limit+1 rows to trigger the "has more" branch.
    const rows = Array.from({ length: 6 }, (_, i) => makeResult(i));
    const prisma = makeP({ checkResults: rows });
    const svc = makeService(prisma);
    const result = await svc.listCheckResults("org_1", "mon_1", { limit: 5 });
    expect(result!.items).toHaveLength(5);
    expect(result!.nextCursor).not.toBeNull();
  });

  it("filters by region when specified", async () => {
    const prisma = makeP({ checkResults: [] });
    const svc = makeService(prisma);
    await svc.listCheckResults("org_1", "mon_1", { limit: 50, region: "EU_WEST" });
    expect(prisma.checkResult.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ region: "EU_WEST" }]),
        }),
      }),
    );
  });
});

// ── listMaintenanceWindows ────────────────────────────────────────────────────

describe("listMaintenanceWindows", () => {
  it("throws not-found when the monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    await expect(svc.listMaintenanceWindows("org_1", "mon_ghost")).rejects.toThrow();
  });

  it("returns windows that include this monitor", async () => {
    const win = {
      id: "win_1",
      title: "Deploy Window",
      description: null,
      startsAt: new Date(),
      endsAt: new Date(),
      suppressAlerts: true,
      createdAt: new Date(),
    };
    const prisma = makeP({ maintenanceWindows: [win] });
    const svc = makeService(prisma);
    const result = await svc.listMaintenanceWindows("org_1", "mon_1");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("win_1");
  });

  it("queries windows scoped to both org and monitor", async () => {
    const prisma = makeP({ maintenanceWindows: [] });
    const svc = makeService(prisma);
    await svc.listMaintenanceWindows("org_1", "mon_1");
    expect(prisma.maintenanceWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org_1",
          monitors: { some: { id: "mon_1" } },
        }),
      }),
    );
  });
});

// ── setChannels ───────────────────────────────────────────────────────────────

describe("setChannels", () => {
  it("throws not-found when the monitor does not exist", async () => {
    const prisma = makeP({ monitorFindFirst: null });
    const svc = makeService(prisma);
    await expect(svc.setChannels("org_1", "mon_ghost", ["chan_1"])).rejects.toThrow();
  });

  it("throws INVALID_CHANNEL for channels not in this org", async () => {
    const prisma = makeP({ channelCount: 0 });
    const svc = makeService(prisma);
    await expect(svc.setChannels("org_1", "mon_1", ["chan_foreign"])).rejects.toThrow(
      "INVALID_CHANNEL",
    );
  });

  it("deletes existing bindings then creates the new set", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.setChannels("org_1", "mon_1", ["chan_a", "chan_b"]);
    expect(prisma.monitorChannel.deleteMany).toHaveBeenCalledWith({
      where: { monitorId: "mon_1" },
    });
    expect(prisma.monitorChannel.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          { monitorId: "mon_1", channelId: "chan_a" },
          { monitorId: "mon_1", channelId: "chan_b" },
        ],
      }),
    );
  });

  it("clears all bindings when channelIds is empty — no createMany call", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.setChannels("org_1", "mon_1", []);
    expect(prisma.monitorChannel.deleteMany).toHaveBeenCalled();
    expect(prisma.monitorChannel.createMany).not.toHaveBeenCalled();
  });

  it("returns the new set of channel IDs", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    const result = await svc.setChannels("org_1", "mon_1", ["chan_x"]);
    expect(result).toEqual(["chan_x"]);
  });
});
