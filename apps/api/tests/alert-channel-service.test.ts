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

/** A valid Slack integration id — uuid-shaped, as the config validator requires. */
const SLACK_INTEGRATION_ID = "018f5a2c-0000-7000-8000-000000000001";
const SLACK_CONFIG = { integrationId: SLACK_INTEGRATION_ID };
const SLACK_WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/xxxx";

function makeP(
  overrides: {
    findFirst?: unknown;
    updateCount?: number;
    /** null models an unknown / cross-org / soft-deleted Slack integration. */
    slackIntegration?: { webhookUrl: string } | null;
  } = {},
): PrismaClient {
  const findFirstResult = "findFirst" in overrides ? overrides.findFirst : mockRow;
  const slackIntegration =
    "slackIntegration" in overrides ? overrides.slackIntegration : { webhookUrl: SLACK_WEBHOOK_URL };

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
    slackIntegration: {
      findFirst: vi.fn(async () => slackIntegration),
    },
  } as unknown as PrismaClient;
}

/** Stub fetch so no test ever reaches the network. */
function makeFetch(response: { status: number; body?: string }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => response.body ?? "",
    };
  };
  return { fetchImpl: fetchImpl as any, calls };
}

function makeService(
  prisma = makeP(),
  limits = passingLimits(),
  fetchImpl?: any,
) {
  return createAlertChannelService({
    prisma,
    auditLogs: fakeAuditLogs,
    planLimits: limits,
    fetchImpl,
  });
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
      // SLACK is the one type with config validation, so give it a real config.
      await svc.create(
        "org_1",
        { type, name: type, config: type === "SLACK" ? SLACK_CONFIG : {} },
        actor,
      );
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

// ── SLACK config validation ───────────────────────────────────────────────────

describe("SLACK config validation", () => {
  it("accepts a config referencing a resolvable integration", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.create("org_1", { type: "SLACK", name: "Ops", config: SLACK_CONFIG }, actor);
    expect(prisma.alertChannel.create).toHaveBeenCalled();
  });

  it("scopes the integration lookup to the org (no cross-tenant reference)", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.create("org_1", { type: "SLACK", name: "Ops", config: SLACK_CONFIG }, actor);
    expect(prisma.slackIntegration.findFirst).toHaveBeenCalledWith({
      where: { id: SLACK_INTEGRATION_ID, organizationId: "org_1", deletedAt: null },
      select: { webhookUrl: true },
    });
  });

  it("rejects a SLACK config with no integrationId", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await expect(
      svc.create("org_1", { type: "SLACK", name: "Ops", config: {} }, actor),
    ).rejects.toThrow(/integrationId/i);
    expect(prisma.alertChannel.create).not.toHaveBeenCalled();
  });

  it("rejects an integration that does not resolve (unknown, other org, or deleted)", async () => {
    const prisma = makeP({ slackIntegration: null });
    const svc = makeService(prisma);
    await expect(
      svc.create("org_1", { type: "SLACK", name: "Ops", config: SLACK_CONFIG }, actor),
    ).rejects.toThrow(/no longer exists/i);
    expect(prisma.alertChannel.create).not.toHaveBeenCalled();
  });

  it("leaves other channel types permissive so existing rows keep saving", async () => {
    const prisma = makeP();
    const svc = makeService(prisma);
    await svc.create("org_1", { type: "EMAIL", name: "E", config: {} }, actor);
    await svc.create("org_1", { type: "WEBHOOK", name: "W", config: {} }, actor);
    expect(prisma.slackIntegration.findFirst).not.toHaveBeenCalled();
  });

  it("validates on update when the config changes", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, type: "SLACK", config: SLACK_CONFIG } });
    const svc = makeService(prisma);
    await expect(
      svc.update("org_1", "chan_1", { config: { integrationId: "nope" } }, actor),
    ).rejects.toThrow(/not a valid id/i);
    expect(prisma.alertChannel.update).not.toHaveBeenCalled();
  });

  it("validates the post-update shape when only the type changes", async () => {
    // EMAIL config carried onto a SLACK channel must not slip through just
    // because `config` was not part of this request.
    const prisma = makeP({ findFirst: { ...mockRow, type: "EMAIL", config: { email: "a@b.com" } } });
    const svc = makeService(prisma);
    await expect(svc.update("org_1", "chan_1", { type: "SLACK" }, actor)).rejects.toThrow(
      /integrationId/i,
    );
  });

  it("skips validation when neither type nor config is being changed", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, type: "SLACK", config: SLACK_CONFIG } });
    const svc = makeService(prisma);
    await svc.update("org_1", "chan_1", { name: "Renamed" }, actor);
    expect(prisma.slackIntegration.findFirst).not.toHaveBeenCalled();
  });
});

// ── test send ─────────────────────────────────────────────────────────────────

describe("test", () => {
  const slackRow = { ...mockRow, type: "SLACK", name: "Ops Slack", config: SLACK_CONFIG };

  it("returns null when the channel does not exist", async () => {
    const svc = makeService(makeP({ findFirst: null }));
    expect(await svc.test("org_1", "chan_ghost", actor)).toBeNull();
  });

  it("posts to the resolved webhook and stamps verifiedAt on success", async () => {
    const prisma = makeP({ findFirst: slackRow });
    const { fetchImpl, calls } = makeFetch({ status: 200, body: "ok" });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    const result = await svc.test("org_1", "chan_1", actor);

    expect(result).toMatchObject({ ok: true });
    expect(result!.verifiedAt).toBeInstanceOf(Date);
    expect(calls[0]!.url).toBe(SLACK_WEBHOOK_URL);
    expect(prisma.alertChannel.update).toHaveBeenCalledWith({
      where: { id: "chan_1" },
      data: { verifiedAt: result!.verifiedAt },
    });
  });

  it("sends a 'test' event, not a fabricated incident", async () => {
    const prisma = makeP({ findFirst: slackRow });
    const { fetchImpl, calls } = makeFetch({ status: 200 });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    await svc.test("org_1", "chan_1", actor);

    const body = JSON.stringify(calls[0]!.body);
    expect(body).toContain("Test alert from Ops Slack");
    expect(body).toContain("Test notification");
    expect(body).not.toContain("is down");
  });

  it("surfaces Slack's own rejection text and does not stamp verifiedAt", async () => {
    const prisma = makeP({ findFirst: slackRow });
    const { fetchImpl } = makeFetch({ status: 404, body: "no_service" });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    await expect(svc.test("org_1", "chan_1", actor)).rejects.toThrow(/404.*no_service/);
    expect(prisma.alertChannel.update).not.toHaveBeenCalled();
  });

  it("rejects a channel type that cannot deliver, without any network call", async () => {
    const prisma = makeP({ findFirst: { ...mockRow, type: "TELEGRAM" } });
    const { fetchImpl, calls } = makeFetch({ status: 200 });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    await expect(svc.test("org_1", "chan_1", actor)).rejects.toThrow(/cannot deliver yet/i);
    expect(calls).toHaveLength(0);
  });

  it("reports a broken config before attempting a send", async () => {
    const prisma = makeP({ findFirst: slackRow, slackIntegration: null });
    const { fetchImpl, calls } = makeFetch({ status: 200 });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    await expect(svc.test("org_1", "chan_1", actor)).rejects.toThrow(/no longer exists/i);
    expect(calls).toHaveLength(0);
  });

  it("writes an alert_channel.tested audit log entry", async () => {
    const prisma = makeP({ findFirst: slackRow });
    const { fetchImpl } = makeFetch({ status: 200 });
    const svc = makeService(prisma, passingLimits(), fetchImpl);

    await svc.test("org_1", "chan_1", actor);

    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        action: "alert_channel.tested",
        resourceType: "alertChannel",
      }),
    );
  });
});
