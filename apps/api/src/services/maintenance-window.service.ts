import type { PrismaClient, Prisma } from "@backend-uptime/db";
import type { AuditLogService } from "./audit-log.service.js";

export interface CreateMaintenanceInput {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  monitorIds: string[];
}

export interface ActorPayload {
  id: string;
  type: "user" | "api_key";
}

// Strictly typing the return to include the relational monitor data
export type MaintenanceWindowWithMonitors = Prisma.MaintenanceWindowGetPayload<{
  include: { monitors: { select: { id: true; name: true } } };
}>;

export interface MaintenanceWindowService {
  list(organizationId: string): Promise<MaintenanceWindowWithMonitors[]>;
  create(
    organizationId: string,
    actor: ActorPayload,
    input: CreateMaintenanceInput,
  ): Promise<MaintenanceWindowWithMonitors>;
  delete(organizationId: string, actor: ActorPayload, windowId: string): Promise<void>;
}

export function createMaintenanceWindowService(deps: {
  prisma: PrismaClient;
  auditLogs: AuditLogService;
}): MaintenanceWindowService {
  const { prisma, auditLogs } = deps;

  return {
    /**
     * Fetch all active and past windows for a specific organization,
     * ignoring any records that have been soft-deleted.
     */
    async list(organizationId) {
      return await prisma.maintenanceWindow.findMany({
        where: {
          organizationId: organizationId,
          deletedAt: null,
        },
        orderBy: { startsAt: "desc" },
        include: {
          monitors: { select: { id: true, name: true } },
        },
      });
    },

    /**
     * Schedule a new maintenance window, linking specific monitors,
     * and writing an immutable entry into the security logs.
     */
    async create(organizationId, actor, input) {
      // Security Check: Verify all provided monitor IDs actually belong to this organization
      if (input.monitorIds.length > 0) {
        const ownedCount = await prisma.monitor.count({
          where: { id: { in: input.monitorIds }, organizationId },
        });
        if (ownedCount !== input.monitorIds.length) {
          throw new Error("INVALID_MONITOR");
        }
      }

      const newWindow = await prisma.maintenanceWindow.create({
        data: {
          organizationId,
          title: input.title,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdById: actor.id,
          monitors: {
            connect: input.monitorIds.map((id) => ({ id: id })),
          },
        },
        include: {
          monitors: { select: { id: true, name: true } },
        },
      });

      await auditLogs.log({
        organizationId,
        actorId: actor.id,
        actorType: actor.type,
        action: "maintenance_window.created",
        resourceType: "maintenance_window",
        resourceId: newWindow.id,
      });

      return newWindow;
    },

    /**
     * Soft-deletes a window by updating its `deletedAt` field.
     
     */
    async delete(organizationId, actor, windowId) {
      const result = await prisma.maintenanceWindow.updateMany({
        where: { id: windowId, organizationId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      if (result.count === 0) throw new Error("NOT_FOUND");

      await auditLogs.log({
        organizationId,
        actorId: actor.id,
        actorType: actor.type,
        action: "maintenance_window.deleted",
        resourceType: "maintenance_window",
        resourceId: windowId,
      });
    },
  };
}
