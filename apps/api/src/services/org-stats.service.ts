import type { PrismaClient } from "@backend-uptime/db";

export interface OrgOverview {
  members: number;
  pendingInvitations: number;
  /** Phase 2 wires these to real monitor + incident tables. */
  monitors: number;
  openIncidents: number;
  auditEventsLast30d: number;
}

export interface OrgStatsService {
  getOverview(organizationId: string): Promise<OrgOverview>;
}

export function createOrgStatsService(deps: { prisma: PrismaClient }): OrgStatsService {
  const { prisma } = deps;

  return {
    async getOverview(organizationId) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [members, pendingInvitations, auditEventsLast30d, monitors, openIncidents] =
        await Promise.all([
          prisma.member.count({ where: { organizationId } }),
          prisma.invitation.count({
            where: { organizationId, status: "pending", expiresAt: { gt: new Date() } },
          }),
          prisma.auditLog.count({
            where: { organizationId, createdAt: { gte: thirtyDaysAgo } },
          }),
          prisma.monitor.count({ where: { organizationId, deletedAt: null } }),
          prisma.incident.count({
            where: { organizationId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
          }),
        ]);

      return {
        members,
        pendingInvitations,
        monitors,
        openIncidents,
        auditEventsLast30d,
      };
    },
  };
}
