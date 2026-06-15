import { z } from "zod";
import type { Prisma, PrismaClient } from "@backend-uptime/db";
import {
  buildPage,
  type AuditEvent,
  type Page,
  auditLogQuerySchema,
} from "@backend-uptime/shared";
import type { Logger } from "../telemetry.js";
import { afterCursorDesc, parseCursor } from "./cursor.js";

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogEntry {
  id: string;
  organizationId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: unknown;
  createdAt: Date;
}

export interface AuditLogService {
  /** Append-only write. Never throws — auth and request flows must not fail on audit issues. */
  log(event: AuditEvent): Promise<void>;
  list(organizationId: string, query: AuditLogQuery): Promise<Page<AuditLogEntry>>;
}

export function createAuditLogService(deps: {
  prisma: PrismaClient;
  logger: Logger;
}): AuditLogService {
  const { prisma, logger } = deps;

  return {
    async log(event) {
      try {
        await prisma.auditLog.create({
          data: {
            organizationId: event.organizationId ?? null,
            actorId: event.actorId ?? null,
            actorType: event.actorType,
            action: event.action,
            resourceType: event.resourceType,
            resourceId: event.resourceId ?? null,
            ipAddress: event.ipAddress ?? null,
            userAgent: event.userAgent ?? null,
            metadata: (event.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
          },
        });
      } catch (err) {
        logger.error({ err, action: event.action }, "audit log write failed");
      }
    },

    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.AuditLogWhereInput[] = [{ organizationId }];
      if (query.action) conditions.push({ action: query.action });
      if (query.actorId) conditions.push({ actorId: query.actorId });
      if (query.resourceType) conditions.push({ resourceType: query.resourceType });
      if (query.from) conditions.push({ createdAt: { gte: query.from } });
      if (query.to) conditions.push({ createdAt: { lte: query.to } });
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.auditLog.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      });

      return buildPage(rows, query.limit);
    },
  };
}
