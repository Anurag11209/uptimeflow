import { describe, expect, it } from "vitest";
import type { PrismaClient, ProbeRegion } from "@backend-uptime/db";
import { createScheduler, schedulerId, type SchedulableQueue } from "../src/index.js";

interface MonitorRow {
  id: string;
  organizationId: string;
  type: string;
  intervalSeconds: number;
  regions: ProbeRegion[];
}

function fakeQueue(existing: Array<{ key: string; every?: number }> = []) {
  const upserts: Array<{ id: string; every: number }> = [];
  const removes: string[] = [];
  const queue: SchedulableQueue = {
    upsertJobScheduler: async (id, repeat) => {
      upserts.push({ id, every: repeat.every });
    },
    getJobSchedulers: async () => existing,
    removeJobScheduler: async (id) => {
      removes.push(id);
      return true;
    },
  };
  return { queue, upserts, removes };
}

function prismaWith(monitors: MonitorRow[]): PrismaClient {
  return { monitor: { findMany: async () => monitors } } as unknown as PrismaClient;
}

const region: ProbeRegion = "NA_EAST";

describe("scheduler sync", () => {
  it("upserts one scheduler per active monitor in the default region", async () => {
    const { queue, upserts } = fakeQueue();
    const scheduler = createScheduler({
      prisma: prismaWith([{ id: "m1", organizationId: "o1", type: "HTTP", intervalSeconds: 60, regions: [] }]),
      queues: new Map([[region, queue]]),
    });

    const summary = await scheduler.sync();
    expect(summary).toMatchObject({ monitors: 1, upserts: 1, removals: 0 });
    expect(upserts[0]).toEqual({ id: schedulerId("m1", region), every: 60_000 });
  });

  it("removes schedulers for monitors that are gone", async () => {
    const { queue, removes } = fakeQueue([{ key: schedulerId("old", region), every: 60_000 }]);
    const scheduler = createScheduler({ prisma: prismaWith([]), queues: new Map([[region, queue]]) });

    const summary = await scheduler.sync();
    expect(summary.removals).toBe(1);
    expect(removes).toEqual([schedulerId("old", region)]);
  });

  it("does not re-upsert an unchanged scheduler", async () => {
    const { queue, upserts } = fakeQueue([{ key: schedulerId("m1", region), every: 30_000 }]);
    const scheduler = createScheduler({
      prisma: prismaWith([{ id: "m1", organizationId: "o1", type: "TCP", intervalSeconds: 30, regions: [] }]),
      queues: new Map([[region, queue]]),
    });

    const summary = await scheduler.sync();
    expect(summary.upserts).toBe(0);
    expect(upserts).toHaveLength(0);
  });

  it("fans a monitor out to each of its configured served regions", async () => {
    const na = fakeQueue();
    const eu = fakeQueue();
    const scheduler = createScheduler({
      prisma: prismaWith([
        { id: "m1", organizationId: "o1", type: "HTTP", intervalSeconds: 60, regions: ["NA_EAST", "EU_WEST"] },
      ]),
      queues: new Map<ProbeRegion, SchedulableQueue>([
        ["NA_EAST", na.queue],
        ["EU_WEST", eu.queue],
      ]),
    });

    await scheduler.sync();
    expect(na.upserts).toHaveLength(1);
    expect(eu.upserts).toHaveLength(1);
  });

  it("schedules heartbeats in the default region only", async () => {
    const na = fakeQueue();
    const eu = fakeQueue();
    const scheduler = createScheduler({
      prisma: prismaWith([
        { id: "hb", organizationId: "o1", type: "HEARTBEAT", intervalSeconds: 300, regions: ["EU_WEST"] },
      ]),
      queues: new Map<ProbeRegion, SchedulableQueue>([
        ["NA_EAST", na.queue],
        ["EU_WEST", eu.queue],
      ]),
      defaultRegion: "NA_EAST",
    });

    await scheduler.sync();
    expect(na.upserts).toHaveLength(1);
    expect(eu.upserts).toHaveLength(0);
  });
});
