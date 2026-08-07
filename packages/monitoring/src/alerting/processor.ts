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
  /**
   * Per-channel-type transports. There is deliberately no fallback: a channel
   * type absent from this map fails the delivery rather than being quietly
   * absorbed. A catch-all that returns success would mark alerts DELIVERED and
   * write a "notification sent" timeline entry for a message nobody received,
   * which is worse than an outright failure — the customer believes they were
   * paged. Adding a channel type means adding a real transport.
   */
  transports?: Partial<Record<AlertChannelType, AlertTransport>>;
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
        // organizationId travels with the channel so a transport that resolves
        // related rows (e.g. SLACK → SlackIntegration) can scope by tenant.
        channel: { select: { id: true, organizationId: true, type: true, name: true, config: true } },
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

    const transport = transports[delivery.channel.type];
    if (!transport) {
      // Fail closed, and loudly. Returning (rather than throwing) is deliberate:
      // a retry can never conjure a transport, so BullMQ backoff would only
      // delay the same outcome. No NOTIFICATION_SENT event is written.
      const lastError = `No transport configured for channel type ${delivery.channel.type} — nothing was sent.`;
      await deps.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: "FAILED", lastError },
      });
      deps.logger?.error(
        { deliveryId, incidentId, channelId: delivery.channel.id, channelType: delivery.channel.type },
        "alert not sent — no transport for channel type",
      );
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
