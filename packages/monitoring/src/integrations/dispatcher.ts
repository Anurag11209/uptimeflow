import type { IntegrationType, PrismaClient } from "@backend-uptime/db";
import type { IntegrationEvent, IntegrationEventName } from "@backend-uptime/notifications";
import { INTEGRATION_JOB_NAME, type IntegrationJobData } from "./queue.js";

/** Minimal queue surface (real BullMQ Queue satisfies it; tests pass a fake). */
export interface IntegrationEnqueuer {
  add(name: string, data: IntegrationJobData, opts?: { jobId?: string }): Promise<unknown>;
}

export interface IncidentDispatchContext {
  incidentId: string;
  organizationId: string;
  monitorId: string;
  monitorName: string;
  kind: "opened" | "resolved";
}

export interface EventDispatchContext {
  organizationId: string;
  eventName: IntegrationEventName;
  /** Stable per-event-instance id used to build idempotent dedupe keys. */
  dedupeBase: string;
  event: IntegrationEvent;
}

export interface TestDispatchContext {
  organizationId: string;
  integrationType: IntegrationType;
  integrationId: string;
  event: IntegrationEvent;
}

export interface IntegrationDispatcher {
  /** Fan an incident transition out to every enabled integration for the org. */
  dispatchIncident(ctx: IncidentDispatchContext): Promise<number>;
  /** Fan an arbitrary event out (acks, maintenance, …) to all enabled integrations. */
  dispatchEvent(ctx: EventDispatchContext): Promise<number>;
  /** Enqueue a single delivery to one specific integration (the test button). */
  dispatchTest(ctx: TestDispatchContext): Promise<string>;
}

export interface IntegrationDispatcherDeps {
  prisma: PrismaClient;
  queue: IntegrationEnqueuer;
  /** Public app origin used to build deep links. */
  webUrl: string;
  logger?: { info(o: Record<string, unknown>, m: string): void };
}

interface Target {
  type: IntegrationType;
  id: string;
}

/**
 * Resolves an org's enabled integrations and enqueues one delivery per target,
 * recording a PENDING IntegrationDelivery row first (queue-first, ADR-003).
 * The delivery's dedupeKey makes the whole fan-out idempotent: replaying the
 * same event never creates a second row or a second send.
 */
export function createIntegrationDispatcher(deps: IntegrationDispatcherDeps): IntegrationDispatcher {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  /** Every enabled, non-deleted integration target for the org. */
  async function targetsFor(organizationId: string): Promise<Target[]> {
    const slack = await deps.prisma.slackIntegration.findMany({
      where: { organizationId, enabled: true, deletedAt: null },
      select: { id: true },
    });
    return slack.map((s) => ({ type: "SLACK" as const, id: s.id }));
  }

  async function fanOut(
    organizationId: string,
    eventName: string,
    dedupeBase: string,
    event: IntegrationEvent,
  ): Promise<number> {
    const targets = await targetsFor(organizationId);
    let enqueued = 0;
    for (const target of targets) {
      const dedupeKey = `${dedupeBase}:${target.type}:${target.id}`;
      // Idempotency: a unique dedupeKey means a replay collides and is skipped.
      let deliveryId: string;
      try {
        const delivery = await deps.prisma.integrationDelivery.create({
          data: {
            organizationId,
            integrationType: target.type,
            integrationId: target.id,
            event: eventName,
            status: "PENDING",
            dedupeKey,
          },
          select: { id: true },
        });
        deliveryId = delivery.id;
      } catch {
        continue; // dedupeKey already exists — already dispatched.
      }
      await deps.queue.add(
        INTEGRATION_JOB_NAME,
        { deliveryId, integrationType: target.type, integrationId: target.id, organizationId, event },
        { jobId: deliveryId },
      );
      enqueued++;
    }
    deps.logger?.info({ organizationId, event: eventName, enqueued }, "integrations dispatched");
    return enqueued;
  }

  return {
    dispatchEvent(ctx) {
      return fanOut(ctx.organizationId, ctx.eventName, ctx.dedupeBase, ctx.event);
    },

    async dispatchTest(ctx) {
      const delivery = await deps.prisma.integrationDelivery.create({
        data: {
          organizationId: ctx.organizationId,
          integrationType: ctx.integrationType,
          integrationId: ctx.integrationId,
          event: "test",
          status: "PENDING",
        },
        select: { id: true },
      });
      await deps.queue.add(
        INTEGRATION_JOB_NAME,
        {
          deliveryId: delivery.id,
          integrationType: ctx.integrationType,
          integrationId: ctx.integrationId,
          organizationId: ctx.organizationId,
          event: ctx.event,
        },
        { jobId: delivery.id },
      );
      deps.logger?.info({ deliveryId: delivery.id, integrationType: ctx.integrationType }, "integration test dispatched");
      return delivery.id;
    },

    dispatchIncident(ctx) {
      const opened = ctx.kind === "opened";
      const event: IntegrationEvent = {
        event: opened ? "incident.opened" : "incident.resolved",
        title: opened ? `${ctx.monitorName} is down` : `${ctx.monitorName} has recovered`,
        monitorName: ctx.monitorName,
        status: opened ? "DOWN" : "RESOLVED",
        url: `${webUrl}/incidents/${ctx.incidentId}`,
        timestamp: new Date().toISOString(),
      };
      return fanOut(ctx.organizationId, `incident.${ctx.kind}`, `incident:${ctx.incidentId}:${ctx.kind}`, event);
    },
  };
}
