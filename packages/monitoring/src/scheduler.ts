import type { PrismaClient, ProbeRegion } from "@backend-uptime/db";
import { CHECK_JOB_NAME, DEFAULT_REGION } from "./queues.js";
import type { CheckJobData } from "./types.js";

export interface SchedulerLogger {
  info(payload: Record<string, unknown>, message: string): void;
  warn(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

/** Structural subset of a BullMQ Queue the scheduler needs (keeps it testable). */
export interface SchedulableQueue {
  upsertJobScheduler(
    jobSchedulerId: string,
    repeat: { every: number },
    template: { name: string; data: CheckJobData },
  ): Promise<unknown>;
  getJobSchedulers(): Promise<Array<{ key: string; every?: string | number | null }>>;
  removeJobScheduler(jobSchedulerId: string): Promise<boolean>;
}

export interface SchedulerDeps {
  prisma: PrismaClient;
  /** One queue per region this deployment serves. */
  queues: Map<ProbeRegion, SchedulableQueue>;
  logger?: SchedulerLogger;
  defaultRegion?: ProbeRegion;
  /** How often to re-sync from the monitor table (ms). Default 30s. */
  syncIntervalMs?: number;
}

export interface SyncSummary {
  monitors: number;
  upserts: number;
  removals: number;
}

const SCHEDULER_PREFIX = "monitor:";

export function schedulerId(monitorId: string, region: ProbeRegion): string {
  return `${SCHEDULER_PREFIX}${monitorId}:${region}`;
}

/**
 * The scheduler turns the monitor table into BullMQ job schedulers: one
 * repeatable check per (monitor, region) firing every `intervalSeconds`. It is
 * declarative — each sync reconciles the live schedulers against the desired
 * set, adding new/changed monitors and removing paused/deleted ones — so it is
 * safe to run on every instance and converges regardless of prior state.
 */
export function createScheduler(deps: SchedulerDeps) {
  const defaultRegion = deps.defaultRegion ?? DEFAULT_REGION;
  const served = new Set(deps.queues.keys());

  async function sync(): Promise<SyncSummary> {
    const monitors = await deps.prisma.monitor.findMany({
      where: { state: "ACTIVE", deletedAt: null },
      select: { id: true, organizationId: true, type: true, intervalSeconds: true, regions: true },
    });

    // Desired schedulers, grouped by region.
    const desired = new Map<ProbeRegion, Map<string, { every: number; data: CheckJobData }>>();
    for (const region of deps.queues.keys()) desired.set(region, new Map());

    for (const m of monitors) {
      // Heartbeats are evaluated centrally (not regionally); everything else
      // fans out to its configured regions, or the default when unset.
      const regions: ProbeRegion[] =
        m.type === "HEARTBEAT" ? [defaultRegion] : m.regions.length > 0 ? m.regions : [defaultRegion];

      for (const region of regions) {
        if (!served.has(region)) continue;
        desired.get(region)!.set(schedulerId(m.id, region), {
          every: Math.max(1, m.intervalSeconds) * 1000,
          data: { monitorId: m.id, organizationId: m.organizationId, region },
        });
      }
    }

    let upserts = 0;
    let removals = 0;

    for (const [region, queue] of deps.queues) {
      const want = desired.get(region)!;
      const existing = await queue.getJobSchedulers();
      const existingEvery = new Map(
        existing.map((e) => [e.key, e.every != null ? Number(e.every) : null] as const),
      );

      for (const [id, spec] of want) {
        if (existingEvery.get(id) === spec.every) continue; // unchanged
        await queue.upsertJobScheduler(id, { every: spec.every }, { name: CHECK_JOB_NAME, data: spec.data });
        upserts++;
      }

      for (const entry of existing) {
        if (entry.key.startsWith(SCHEDULER_PREFIX) && !want.has(entry.key)) {
          await queue.removeJobScheduler(entry.key);
          removals++;
        }
      }
    }

    const summary: SyncSummary = { monitors: monitors.length, upserts, removals };
    deps.logger?.info({ ...summary }, "scheduler synced");
    return summary;
  }

  /** Run an initial sync, then re-sync on an interval. Returns a stop handle. */
  function start(): { stop: () => void } {
    const interval = deps.syncIntervalMs ?? 30_000;
    void sync().catch((err) => deps.logger?.error({ err }, "scheduler sync failed"));
    const timer = setInterval(() => {
      void sync().catch((err) => deps.logger?.error({ err }, "scheduler sync failed"));
    }, interval);
    timer.unref?.();
    return { stop: () => clearInterval(timer) };
  }

  return { sync, start };
}

export type Scheduler = ReturnType<typeof createScheduler>;
