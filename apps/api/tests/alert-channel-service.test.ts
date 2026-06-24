import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import {
  createAlertChannelService,
  type AlertChannelActor,
} from "../src/services/alert-channel.service.js";
import type { AuditLogService } from "../src/services/audit-log.service.js";
import type { PlanLimitsService } from "../src/services/plan-limits.service.js";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const actor: AlertChannelActor = { userId: "user_1", actorType: "user" };

const mockRow = {
  id: "chan_1",
  type: "EMAIL" as const,
  name: "Ops Email",
  config: { email: "ops@example.com" },
  enabled: true,
  verifiedAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  monitorBindings: [],
};

// ─── Fake deps ────────────────────────────────────────────────────────────────

const fakeAuditLogs: AuditLogService = {
  log: vi.fn(async () => {}),
} as unknown as AuditLogService;

function passingLimits(): PlanLimitsService {
  return {
    assertWithinLimit: vi.fn(async () => {}),
    assertCapability: vi.fn(async () => {}),
  } as unknown as PlanLimitsService;
}

/** Plan limits that block the given capability. */
function blockCapability(cap: string): PlanLimitsService {
  return {
    assertWithinLimit: vi.fn(async () => {}),
    assertCapability: vi.fn(async (_orgId: string, capability: string) => {
      if (capability === cap) {
        throw Object.assign(new Error("PAYMENT_REQUIRED"), { statusCode: 402 });
      }
    }),
  } as unknown as PlanLimitsService;
}

function makeP(
  overrides: {
    findFirst?: unknown;
    updateCount?: number;
  } = {},
): PrismaClient {
  const findFirstResult = "findFirst" in overrides ? overrides.findFirst : mockRow;

  return {
    alertChannel: {
      findFirst: vi.fn(async () => findFirstResult),
      findMany: vi.fn(async () => (findFirstResult ? [findFirstResult] : [])),
      create: vi.fn(async (args: any) => ({
        ...mockRow,
        ...args.data,
        id: "chan_new",
        monitorBindings: [],
      })),
      update: vi.fn(async () => findFirstResult),
      updateMany: vi.fn(async () => ({
        count: overrides.updateCount ?? 1,
      })),
    },
  } as unknown as PrismaClient;
}

function makeService(prisma = makeP(), limits = passingLimits()) {
  return createAlertChannelService({ prisma, auditLogs: fakeAuditLogs, planLimits: limits });
}

beforeEach(() => vi.clearAllMocks());

// ── create ────────────────────────────────────────────────────────────────────

describe("create", () => {
  it("creates an EMAIL channel without any capability check", async () => {
    const limits = passingLimits();
    const prisma = makeP();
    const svc = makeService(prisma, limits);
    const result = await svc.create(
      "org_1",
      { type: "EMAIL", name: "Alerts", config: { email: "a@b.com" } },
      actor,
    );
    expect(result.id).toBe("chan_new");
    expect(limits.assertCapability).not.toHaveBeenCalled();
  });

  it("checks 'sms' capability before creating an SMS channel", async () => {
    const limits = passingLimits();
    const prisma = makeP();
    const svc = makeService(prisma, limits);
    await svc.create("org_1", { type: "SMS", name: "SMS Alerts", config: {} }, actor);
    expect(limits.assertCapability).toHaveBeenCalledWith("org_1", "sms");
  });

  it("checks 'voice' capability before creating a VOICE channel", async () => {
    const limits = passingLimits();
    const prisma = makeP();
    const svc = makeService(prisma, limits);
    await svc.create("org_1", { type: "VOICE", name: "Voice Alerts", config: {} }, actor);
    expect(limits.assertCapability).toHaveBeenCalledWith("org_1", "voice");
  });

  it("propagates rejection when SMS capability is not on the plan", async () => {
    const limits = blockCapability("sms");
    const prisma = makeP();
    const svc = makeService(prisma, limits);
    await expect(
      svc.create("org_1", { type: "SMS", name: "SMS", config: {} }, actor),
    ).rejects.toThrow();
    expect(prisma.alertChannel.create).not.toHaveBeenCalled();
  });

  it("propagates rejection when VOICE capability is not on the plan", async () => {
    const limits = blockCapability("voice");
    const svc = makeService(makeP(), limits);
    await expect(
      svc.create("org_1", { type: "VOICE", name: "Voice", config: {} }, actor),
    ).rejects.toThrow();
  });

  it("does not check capability for WEBHOOK, SLACK, DISCORD, PAGERDUTY, OPSGENIE", async () => {
    const limits = passingLimits();
    const types = ["WEBHOOK", "SLACK", "DISCORD", "PAGERDUTY", "OPSGENIE"] as const;
    for (const type of types) {
      const svc = makeService(makeP(), limits);
      await svc.create("org_1", { type, name: type, config: {} }, actor);
    }
    expect(limits.assertCapability).not.toHaveBeenCalled();
  });

  it("writes an alert_channel.created audit log entry", async () => {
    const svc = makeService();
    await svc.create("org_1", { type: "EMAIL", name: "E", config: {} }, actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        actorId: "user_1",
        action: "alert_channel.created",
        resourceType: "alertChannel",
      }),
    );
  });
});

// ── update ────────────────────────────────────────────────────────────────────

describe("update", () => {
  it("returns null when channel does not exist", async () => {
    const svc = makeService(makeP({ findFirst: null }));
    expect(await svc.update("org_1", "chan_ghost", { name: "X" }, actor)).toBeNull();
  });

  it("checks capability when changing type to SMS", async () => {
    // Existing is EMAIL; update to SMS should trigger capability check.
    const limits = passingLimits();
    const svc = makeService(makeP(), limits);
    await svc.update("org_1", "chan_1", { type: "SMS" }, actor);
    expect(limits.assertCapability).toHaveBeenCalledWith("org_1", "sms");
  });

  it("skips capability check when type is unchanged", async () => {
    const limits = passingLimits();
    const svc = makeService(makeP(), limits);
    await svc.update("org_1", "chan_1", { name: "Renamed" }, actor);
    expect(limits.assertCapability).not.toHaveBeenCalled();
  });

  it("skips capability check when type stays the same (EMAIL → EMAIL)", async () => {
    const limits = passingLimits();
    const svc = makeService(makeP(), limits);
    await svc.update("org_1", "chan_1", { type: "EMAIL", name: "Renamed" }, actor);
    expect(limits.assertCapability).not.toHaveBeenCalled();
  });

  it("blocks update to SMS when SMS is not on the plan", async () => {
    const limits = blockCapability("sms");
    const svc = makeService(makeP(), limits);
    await expect(svc.update("org_1", "chan_1", { type: "SMS" }, actor)).rejects.toThrow();
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("writes an alert_channel.updated audit log entry", async () => {
    const svc = makeService();
    await svc.update("org_1", "chan_1", { name: "New Name" }, actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "alert_channel.updated", resourceId: "chan_1" }),
    );
  });
});

// ── enable ────────────────────────────────────────────────────────────────────

describe("enable", () => {
  it("returns null when channel does not exist", async () => {
    const svc = makeService(makeP({ findFirst: null }));
    expect(await svc.enable("org_1", "chan_ghost", actor)).toBeNull();
  });

  it("calls update with enabled=true when currently disabled", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, enabled: false } });
    const svc = makeService(prisma);
    await svc.enable("org_1", "chan_1", actor);
    expect(prisma.alertChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: true }) }),
    );
  });

  it("is idempotent — skips DB write when already enabled", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, enabled: true } });
    const svc = makeService(prisma);
    await svc.enable("org_1", "chan_1", actor);
    expect(prisma.alertChannel.update).not.toHaveBeenCalled();
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("writes an alert_channel.enabled audit log entry", async () => {
    const svc = makeService(makeP({ findFirst: { ...mockRow, enabled: false } }));
    await svc.enable("org_1", "chan_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "alert_channel.enabled", resourceId: "chan_1" }),
    );
  });
});

// ── disable ───────────────────────────────────────────────────────────────────

describe("disable", () => {
  it("returns null when channel does not exist", async () => {
    const svc = makeService(makeP({ findFirst: null }));
    expect(await svc.disable("org_1", "chan_ghost", actor)).toBeNull();
  });

  it("calls update with enabled=false when currently enabled", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, enabled: true } });
    const svc = makeService(prisma);
    await svc.disable("org_1", "chan_1", actor);
    expect(prisma.alertChannel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ enabled: false }) }),
    );
  });

  it("is idempotent — skips DB write when already disabled", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, enabled: false } });
    const svc = makeService(prisma);
    await svc.disable("org_1", "chan_1", actor);
    expect(prisma.alertChannel.update).not.toHaveBeenCalled();
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("writes an alert_channel.disabled audit log entry", async () => {
    const svc = makeService(makeP({ findFirst: { ...mockRow, enabled: true } }));
    await svc.disable("org_1", "chan_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "alert_channel.disabled", resourceId: "chan_1" }),
    );
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe("remove", () => {
  it("returns false when channel does not exist", async () => {
    const prisma = makeP({ updateCount: 0 });
    const svc = makeService(prisma);
    expect(await svc.remove("org_1", "chan_ghost", actor)).toBe(false);
    expect(fakeAuditLogs.log).not.toHaveBeenCalled();
  });

  it("returns true and soft-deletes the channel", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    expect(await svc.remove("org_1", "chan_1", actor)).toBe(true);
    expect(prisma.alertChannel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "chan_1", deletedAt: null }),
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });

  it("writes an alert_channel.deleted audit log entry", async () => {
    const svc = makeService();
    await svc.remove("org_1", "chan_1", actor);
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: "alert_channel.deleted", resourceId: "chan_1" }),
    );
  });
});

// ── get ───────────────────────────────────────────────────────────────────────

describe("get", () => {
  it("returns null when channel does not exist", async () => {
    const svc = makeService(makeP({ findFirst: null }));
    expect(await svc.get("org_1", "chan_ghost")).toBeNull();
  });

  it("returns detail including boundMonitorIds", async () => {
    const row = { ...mockRow, monitorBindings: [{ monitorId: "mon_1" }, { monitorId: "mon_2" }] };
    const svc = makeService(makeP({ findFirst: row }));
    const result = await svc.get("org_1", "chan_1");
    expect(result).not.toBeNull();
    expect(result!.boundMonitorIds).toEqual(["mon_1", "mon_2"]);
  });
});
