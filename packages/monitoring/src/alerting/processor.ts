import type { Job } from "bullmq";
import type { AlertChannelType, PrismaClient } from "@backend-uptime/db";
import type { AlertJobData } from "./queue.js";
import type { AlertPayload, AlertTransport } from "./transports.js";

export interface AlertProcessorLogger {
  info(payload: Record<string, unknown>, message: string): void;
  error(payload: Record<string, unknown>, message: string): void;
}

export interface AlertProcessorDeps {
  prisma: PrismaClient;
  /** Per-channel-type transports; falls back to `fallback` when absent. */
  transports?: Partial<Record<AlertChannelType, AlertTransport>>;
  fallback?: AlertTransport;
  logger?: AlertProcessorLogger;
}

export interface AlertJobResult {
  deliveryId: string;
  skipped?: "no_delivery" | "already_delivered" | "no_transport";
  delivered?: boolean;
}

/**
 * Processes one alert delivery: sends it over the channel's transport and
 * records the result on the NotificationDelivery plus a NOTIFICATION_SENT entry
 * on the incident timeline. Idempotent (skips an already-delivered row);
 * throwing on transport failure hands the retry back to BullMQ.
 */
export function createAlertProcessor(deps: AlertProcessorDeps) {
  const transports = deps.transports ?? {};

  return async (job: Job<AlertJobData>): Promise<AlertJobResult> => {
    const { deliveryId, incidentId } = job.data;

    const delivery = await deps.prisma.notificationDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        status: true,
        channel: { select: { id: true, type: true, name: true, config: true } },
        incident: {
          select: {
            id: true,
            title: true,
            summary: true,
            severity: true,
            startedAt: true,
            resolvedAt: true,
            monitor: { select: { name: true } },
          },
        },
      },
    });
    if (!delivery || !delivery.incident) return { deliveryId, skipped: "no_delivery" };
    if (delivery.status === "DELIVERED" || delivery.status === "SENT") {
      return { deliveryId, skipped: "already_delivered" };
    }

    const transport = transports[delivery.channel.type] ?? deps.fallback;
    if (!transport) {
      await deps.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: `No transport for channel type ${delivery.channel.type}.` },
      });
      return { deliveryId, skipped: "no_transport" };
    }

    const now = new Date();
    await deps.prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: "SENDING", attempts: { increment: 1 }, sentAt: now },
    });

    const payload: AlertPayload = {
      kind: job.data.kind,
      incidentId,
      monitorName: delivery.incident.monitor?.name ?? "monitor",
      title: delivery.incident.title,
      severity: delivery.incident.severity,
      summary: delivery.incident.summary,
      occurredAt: now.toISOString(),
    };

    try {
      const { providerMessageId } = await transport(delivery.channel, payload);
      await deps.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "DELIVERED", deliveredAt: new Date(), providerMessageId },
      });
      await deps.prisma.incidentEvent.create({
        data: {
          incidentId,
          type: "NOTIFICATION_SENT",
          message: `Alert (${job.data.kind}) sent via ${delivery.channel.name}.`,
          metadata: { channelId: delivery.channel.id, channelType: delivery.channel.type, deliveryId },
        },
      });
      deps.logger?.info({ deliveryId, channelType: delivery.channel.type }, "alert delivered");
      return { deliveryId, delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError: message.slice(0, 500) },
      });
      deps.logger?.error({ deliveryId, err: message }, "alert delivery failed");
      throw error; // surface to BullMQ retry/backoff
    }
  };
}
