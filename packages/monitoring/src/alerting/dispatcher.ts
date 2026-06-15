import type { PrismaClient } from "@backend-uptime/db";
import { ALERT_JOB_NAME, type AlertJobData, type AlertKind } from "./queue.js";

export interface AlertContext {
  incidentId: string;
  organizationId: string;
  monitorId: string;
  kind: AlertKind;
}

export interface ChannelDispatchContext {
  incidentId: string;
  organizationId: string;
  channelIds: string[];
  kind: AlertKind;
}

export interface AlertDispatcher {
  /** Resolve a monitor's channels, record deliveries, enqueue sends; returns count. */
  dispatch(ctx: AlertContext): Promise<number>;
  /** Dispatch to an explicit set of channels (used by escalation steps). */
  dispatchToChannels(ctx: ChannelDispatchContext): Promise<number>;
}

/** Minimal queue surface (real BullMQ Queue satisfies it; tests pass a fake). */
export interface AlertEnqueuer {
  add(name: string, data: AlertJobData, opts?: unknown): Promise<unknown>;
}

export interface AlertDispatcherDeps {
  prisma: PrismaClient;
  queue: AlertEnqueuer;
  logger?: { info(o: Record<string, unknown>, m: string): void };
}

/**
 * Fans an incident event out to every alert channel bound to the monitor. It
 * records one NotificationDelivery (PENDING) per channel and enqueues a send
 * job — queue-first (ADR-003), so the check pipeline never blocks on a provider.
 * Channels are filtered to enabled, non-deleted; all rows carry organizationId.
 */
export function createAlertDispatcher(deps: AlertDispatcherDeps): AlertDispatcher {
  return {
    async dispatch(ctx) {
      const bindings = await deps.prisma.monitorChannel.findMany({
        where: { monitorId: ctx.monitorId, channel: { enabled: true, deletedAt: null } },
        select: { channelId: true },
      });

      let enqueued = 0;
      for (const { channelId } of bindings) {
        const delivery = await deps.prisma.notificationDelivery.create({
          data: {
            organizationId: ctx.organizationId,
            channelId,
            incidentId: ctx.incidentId,
            status: "PENDING",
            attempts: 0,
          },
          select: { id: true },
        });
        await deps.queue.add(ALERT_JOB_NAME, {
          deliveryId: delivery.id,
          incidentId: ctx.incidentId,
          channelId,
          organizationId: ctx.organizationId,
          kind: ctx.kind,
        });
        enqueued++;
      }

      deps.logger?.info({ incidentId: ctx.incidentId, kind: ctx.kind, enqueued }, "alerts dispatched");
      return enqueued;
    },

    async dispatchToChannels(ctx) {
      let enqueued = 0;
      for (const channelId of ctx.channelIds) {
        // Verify the channel belongs to the org and is live — never enqueue to a
        // cross-tenant or disabled channel.
        const channel = await deps.prisma.alertChannel.findFirst({
          where: { id: channelId, organizationId: ctx.organizationId, enabled: true, deletedAt: null },
          select: { id: true },
        });
        if (!channel) continue;
        const delivery = await deps.prisma.notificationDelivery.create({
          data: {
            organizationId: ctx.organizationId,
            channelId,
            incidentId: ctx.incidentId,
            status: "PENDING",
            attempts: 0,
          },
          select: { id: true },
        });
        await deps.queue.add(ALERT_JOB_NAME, {
          deliveryId: delivery.id,
          incidentId: ctx.incidentId,
          channelId,
          organizationId: ctx.organizationId,
          kind: ctx.kind,
        });
        enqueued++;
      }
      deps.logger?.info({ incidentId: ctx.incidentId, enqueued }, "channel alerts dispatched");
      return enqueued;
    },
  };
}
