import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import type { FetchLike, IntegrationEvent } from "@backend-uptime/notifications";
import {
  createIntegrationDispatcher,
  createIntegrationProcessor,
  type IntegrationJobData,
} from "../src/index.js";

const okFetch: FetchLike = async () => ({ status: 200, ok: true, text: async () => "ok" });
const failFetch: FetchLike = async () => ({ status: 500, ok: false, text: async () => "boom" });

const testEvent: IntegrationEvent = { event: "test", title: "Test", timestamp: "2026-06-17T00:00:00Z" };

function job(data: IntegrationJobData, attemptsMade = 0, attempts = 5): Job<IntegrationJobData> {
  return { data, attemptsMade, opts: { attempts } } as unknown as Job<IntegrationJobData>;
}

describe("integration dispatcher", () => {
  it("creates a delivery and enqueues a job per enabled integration", async () => {
    const created: Record<string, unknown>[] = [];
    const enqueued: { data: IntegrationJobData; opts?: { jobId?: string } }[] = [];
    const prisma = {
      slackIntegration: { findMany: async () => [{ id: "sl_1" }, { id: "sl_2" }] },
      discordIntegration: { findMany: async () => [] },
      webhookIntegration: { findMany: async () => [] },
      integrationDelivery: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: `del_${created.length}` };
        },
      },
    } as unknown as PrismaClient;

    const dispatcher = createIntegrationDispatcher({
      prisma,
      queue: { add: async (_n, data, opts) => void enqueued.push({ data, opts }) },
      webUrl: "https://app.uptimeflow.dev",
    });

    const count = await dispatcher.dispatchIncident({
      incidentId: "inc_1",
      organizationId: "org_1",
      monitorId: "mon_1",
      monitorName: "Acme API",
      kind: "opened",
    });

    expect(count).toBe(2);
    expect(created[0]).toMatchObject({ integrationType: "SLACK", event: "incident.opened", status: "PENDING" });
    expect(created[0]!.dedupeKey).toBe("incident:inc_1:opened:SLACK:sl_1");
    expect(enqueued[0]!.opts?.jobId).toBe("del_1");
    expect(enqueued[0]!.data.event.event).toBe("incident.opened");
  });

  it("is idempotent — a dedupeKey conflict skips that target", async () => {
    const prisma = {
      slackIntegration: { findMany: async () => [{ id: "sl_1" }] },
      discordIntegration: { findMany: async () => [] },
      webhookIntegration: { findMany: async () => [] },
      integrationDelivery: {
        create: async () => {
          throw new Error("unique constraint failed: dedupeKey");
        },
      },
    } as unknown as PrismaClient;
    let enqueued = 0;
    const dispatcher = createIntegrationDispatcher({
      prisma,
      queue: { add: async () => void enqueued++ },
      webUrl: "https://app",
    });
    const count = await dispatcher.dispatchIncident({
      incidentId: "inc_1",
      organizationId: "org_1",
      monitorId: "mon_1",
      monitorName: "API",
      kind: "opened",
    });
    expect(count).toBe(0);
    expect(enqueued).toBe(0);
  });

  it("dispatchTest enqueues exactly one delivery for the given integration", async () => {
    const enqueued: IntegrationJobData[] = [];
    const prisma = {
      integrationDelivery: { create: async () => ({ id: "del_test" }) },
    } as unknown as PrismaClient;
    const dispatcher = createIntegrationDispatcher({
      prisma,
      queue: { add: async (_n, data) => void enqueued.push(data) },
      webUrl: "https://app",
    });
    const id = await dispatcher.dispatchTest({
      organizationId: "org_1",
      integrationType: "SLACK",
      integrationId: "sl_1",
      event: testEvent,
    });
    expect(id).toBe("del_test");
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]!.event.event).toBe("test");
  });
});

describe("integration processor", () => {
  function prismaWith(config: Record<string, unknown> | null) {
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      slackIntegration: { findFirst: async () => config },
      integrationDelivery: {
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return {};
        },
      },
    } as unknown as PrismaClient;
    return { prisma, updates };
  }

  const data: IntegrationJobData = {
    deliveryId: "del_1",
    integrationType: "SLACK",
    integrationId: "sl_1",
    organizationId: "org_1",
    event: testEvent,
  };

  it("marks the delivery SUCCESS when the send succeeds", async () => {
    const { prisma, updates } = prismaWith({ webhookUrl: "https://hooks.slack.com/x" });
    const processor = createIntegrationProcessor({ prisma, fetchImpl: okFetch });
    const result = await processor(job(data));
    expect(result.delivered).toBe(true);
    expect(updates.at(-1)).toMatchObject({ status: "SUCCESS", responseStatus: 200 });
  });

  it("marks FAILED and throws (retry) on a transient failure mid-budget", async () => {
    const { prisma, updates } = prismaWith({ webhookUrl: "https://hooks.slack.com/x" });
    const processor = createIntegrationProcessor({ prisma, fetchImpl: failFetch });
    await expect(processor(job(data, 0, 5))).rejects.toThrow(/integration delivery failed/);
    expect(updates.at(-1)).toMatchObject({ status: "FAILED" });
  });

  it("dead-letters on the final attempt", async () => {
    const { prisma, updates } = prismaWith({ webhookUrl: "https://hooks.slack.com/x" });
    const processor = createIntegrationProcessor({ prisma, fetchImpl: failFetch });
    await expect(processor(job(data, 4, 5))).rejects.toThrow();
    expect(updates.at(-1)).toMatchObject({ status: "DEAD" });
  });

  it("skips (no retry) when the integration is missing/deleted", async () => {
    const { prisma, updates } = prismaWith(null);
    const processor = createIntegrationProcessor({ prisma, fetchImpl: okFetch });
    const result = await processor(job(data));
    expect(result.skipped).toBe(true);
    expect(updates.at(-1)).toMatchObject({ status: "FAILED" });
  });
});
