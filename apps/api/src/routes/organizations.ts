import { Router } from "express";
import {
  auditLogQuerySchema,
  listInvitationsQuerySchema,
  listMembersQuerySchema,
} from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { AuditLogQuery, AuditLogService } from "../services/audit-log.service.js";
import type {
  ListInvitationsQuery,
  ListMembersQuery,
  MemberService,
} from "../services/member.service.js";
import type { OrgStatsService } from "../services/org-stats.service.js";

export interface OrganizationsRouterDeps {
  prisma: PrismaClient;
  members: MemberService;
  auditLogs: AuditLogService;
  orgStats: OrgStatsService;
}

/**
 * Read-heavy org endpoints under /v1/organizations/:organizationId.
 * Mutations (create org, invite, change role, remove member, transfer
 * ownership) are served by Better Auth's organization plugin at
 * /api/auth/organization/* with the identical RBAC matrix.
 */
export function organizationsRouter(deps: OrganizationsRouterDeps): Router {
  const router = Router({ mergeParams: true });

  // Every route below operates inside a membership.
  router.use(orgContext(deps.prisma));

  router.get(
    "/members",
    requirePermission("member", "read"),
    validate({ query: listMembersQuerySchema }),
    async (req, res) => {
      const query = getValidated<ListMembersQuery>(req, "query");
      const page = await deps.members.listMembers(req.orgContext!.organizationId, query);
      res.json(page);
    },
  );

  router.get(
    "/invitations",
    requirePermission("invitation", "read"),
    validate({ query: listInvitationsQuerySchema }),
    async (req, res) => {
      const query = getValidated<ListInvitationsQuery>(req, "query");
      const page = await deps.members.listInvitations(req.orgContext!.organizationId, query);
      res.json(page);
    },
  );

  router.get(
    "/audit-logs",
    requirePermission("auditLog", "read"),
    validate({ query: auditLogQuerySchema }),
    async (req, res) => {
      const query = getValidated<AuditLogQuery>(req, "query");
      const page = await deps.auditLogs.list(req.orgContext!.organizationId, query);
      res.json(page);
    },
  );

  router.get("/overview", requirePermission("organization", "read"), async (req, res) => {
    const ctx = req.orgContext!;
    const overview = await deps.orgStats.getOverview(ctx.organizationId);
    res.json({
      organization: ctx.organization,
      // Session callers see their role; API keys report their scopes instead.
      role: ctx.principal.type === "session" ? ctx.principal.role : null,
      scopes: ctx.principal.type === "apiKey" ? ctx.principal.scopes : undefined,
      stats: overview,
    });
  });

  return router;
}
