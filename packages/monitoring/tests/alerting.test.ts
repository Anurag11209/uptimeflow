import type { Job } from "bullmq";
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import {
  createAlertDispatcher,
  createAlertProcessor,
  type AlertJobData,
  type AlertTransport,
} from "../src/index.js";

describe("alert dispatcher", () => {
  it("records a PENDING delivery and enqueues a job per enabled channel", async () => {
    const deliveries: Array<Record<string, unknown>> = [];
    const enqueued: AlertJobData[] = [];
    const prisma = {
      monitorChannel: {
        findMany: async () => [{ channelId: "ch_1" }, { channelId: "ch_2" }],
      },
      notificationDelivery: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          deliveries.push(data);
          return { id: `del_${deliveries.length}` };
        },
      },
    } as unknown as PrismaClient;

    const dispatcher = createAlertDispatcher({
      prisma,
      queue: { add: async (_name, data) => void enqueued.push(data) },
    });

    const count = await dispatcher.dispatch({
      incidentId: "inc_1",
      organizationId: "org_1",
      monitorId: "mon_1",
      kind: "opened",
    });

    expect(count).toBe(2);
    expect(deliveries[0]).toMatchObject({ organizationId: "org_1", channelId: "ch_1", status: "PENDING" });
    expect(enqueued.map((j) => j.deliveryId)).toEqual(["del_1", "del_2"]);
    expect(enqueued[0]).toMatchObject({ kind: "opened", channelId: "ch_1" });
  });
});

describe("alert processor", () => {
  const baseDelivery = {
    id: "del_1",
    status: "PENDING",
    channel: { id: "ch_1", type: "WEBHOOK", name: "Ops webhook", config: { url: "https://hooks.test" } },
    incident: {
      id: "inc_1",
      title: "API down",
      summary: "connect refused",
      severity: "MAJOR",
      startedAt: new Date(),
      resolvedAt: null,
      monitor: { name: "Acme API" },
    },
  };

  function mockPrisma(delivery: unknown) {
    const updates: Array<Record<string, unknown>> = [];
    const events: Array<Record<string, unknown>> = [];
    const prisma = {
      notificationDelivery: {
        findUnique: async () => delivery,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return {};
        },
      },
      incidentEvent: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          events.push(data);
          return { id: "ev_1" };
        },
      },
    } as unknown as PrismaClient;
    return { prisma, updates, events };
  }

  const job = (data: Partial<AlertJobData> = {}): Job<AlertJobData> =>
    ({ data: { deliveryId: "del_1", incidentId: "inc_1", channelId: "ch_1", organizationId: "org_1", kind: "opened", ...data } }) as Job<AlertJobData>;

  it("delivers via the channel transport and writes a NOTIFICATION_SENT event", async () => {
    const { prisma, updates, events } = mockPrisma(baseDelivery);
    const transport: AlertTransport = async () => ({ providerMessageId: "msg_1" });
    const processor = createAlertProcessor({ prisma, transports: { WEBHOOK: transport } });

    const result = await processor(job());
    expect(result).toMatchObject({ deliveryId: "del_1", delivered: true });
    expect(updates.map((u) => u.status)).toEqual(["SENDING", "DELIVERED"]);
    expect(events[0]).toMatchObject({ type: "NOTIFICATION_SENT" });
  });

  it("marks the delivery FAILED and rethrows on transport error", async () => {
    const { prisma, updates } = mockPrisma(baseDelivery);
    const transport: AlertTransport = async () => {
      throw new Error("503 from webhook");
    };
    const processor = createAlertProcessor({ prisma, transports: { WEBHOOK: transport } });

    await expect(processor(job())).rejects.toThrow("503");
    expect(updates.at(-1)).toMatchObject({ status: "FAILED", lastError: "503 from webhook" });
  });

  it("is idempotent for an already-delivered row", async () => {
    const { prisma, updates } = mockPrisma({ ...baseDelivery, status: "DELIVERED" });
    const processor = createAlertProcessor({ prisma, fallback: async () => ({ providerMessageId: null }) });
    const result = await processor(job());
    expect(result.skipped).toBe("already_delivered");
    expect(updates).toHaveLength(0);
  });

  it("fails closed when no transport matches the channel type", async () => {
    const { prisma, updates } = mockPrisma(baseDelivery);
    const processor = createAlertProcessor({ prisma }); // no transports, no fallback
    const result = await processor(job());
    expect(result.skipped).toBe("no_transport");
    expect(updates.at(-1)).toMatchObject({ status: "FAILED" });
  });
});
