import type { PrismaClient, MaintenanceWindow } from "@backend-uptime/db";
import type { AuditLogService } from "./audit-log.service.js";

export interface CreateMaintenanceInput {
  title: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  monitorIds: string[];
}

export interface MaintenanceWindowService {
  list(organizationId: string): Promise<MaintenanceWindow[]>;
  create(
    organizationId: string,
    actorId: string,
    input: CreateMaintenanceInput,
  ): Promise<MaintenanceWindow>;
  delete(organizationId: string, actorId: string, windowId: string): Promise<boolean>;
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
    async create(organizationId, actorId, input) {
      const newWindow = await prisma.maintenanceWindow.create({
        data: {
          organizationId,
          title: input.title,
          description: input.description,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          createdById: actorId,
          monitors: {
            connect: input.monitorIds.map((id) => ({ id: id })),
          },
        },
      });

      await auditLogs.log({
        organizationId,
        actorId: actorId,
        actorType: "user",
        action: "maintenance_window.created",
        resourceType: "maintenance_window",
        resourceId: newWindow.id,
      });

      return newWindow;
    },

    /**
     * Soft-deletes a window by updating its `deletedAt` field.
     * Validates organization ownership before mutating data.
     */
    async delete(organizationId, actorId, windowId) {
      const existing = await prisma.maintenanceWindow.findFirst({
        where: { id: windowId, organizationId: organizationId, deletedAt: null },
      });

      if (!existing) {
        throw new Error("NOT_FOUND");
      }

      // Perform soft-delete to preserve references in historical data
      await prisma.maintenanceWindow.update({
        where: { id: windowId },
        data: { deletedAt: new Date() },
      });

      await auditLogs.log({
        organizationId,
        actorId: actorId,
        actorType: "user",
        action: "maintenance_window.deleted",
        resourceType: "maintenance_window",
        resourceId: windowId,
      });

      return true;
    },
  };
}
