import { z } from "zod";
import type { Prisma, PrismaClient } from "@backend-uptime/db";
import {
  buildPage,
  type Page,
  listInvitationsQuerySchema,
  listMembersQuerySchema,
} from "@backend-uptime/shared";
import { afterCursorAsc, afterCursorDesc, parseCursor } from "./cursor.js";

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type ListInvitationsQuery = z.infer<typeof listInvitationsQuerySchema>;

export interface MemberListItem {
  id: string;
  role: string;
  createdAt: Date;
  user: { id: string; name: string; email: string; image: string | null };
}

export interface InvitationListItem {
  id: string;
  email: string;
  role: string | null;
  status: string;
  expiresAt: Date;
  createdAt: Date;
  inviter: { id: string; name: string; email: string } | null;
}

export interface MemberService {
  listMembers(organizationId: string, query: ListMembersQuery): Promise<Page<MemberListItem>>;
  listInvitations(
    organizationId: string,
    query: ListInvitationsQuery,
  ): Promise<Page<InvitationListItem>>;
}

/**
 * Read-side queries for org people management. Mutations (invite, change
 * role, remove, transfer ownership) go through Better Auth's organization
 * endpoints, which enforce the same shared RBAC matrix.
 */
export function createMemberService(deps: { prisma: PrismaClient }): MemberService {
  const { prisma } = deps;

  return {
    async listMembers(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.MemberWhereInput[] = [{ organizationId }];
      if (query.role) conditions.push({ role: query.role });
      if (query.query) {
        conditions.push({
          user: {
            OR: [
              { name: { contains: query.query, mode: "insensitive" } },
              { email: { contains: query.query, mode: "insensitive" } },
            ],
          },
        });
      }
      if (cursor) conditions.push(afterCursorAsc(cursor));

      const rows = await prisma.member.findMany({
        where: { AND: conditions },
        include: {
          user: { select: { id: true, name: true, email: true, image: true } },
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: query.limit + 1,
      });

      return buildPage(rows, query.limit);
    },

    async listInvitations(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.InvitationWhereInput[] = [{ organizationId }];
      if (query.status) conditions.push({ status: query.status });
      if (cursor) conditions.push(afterCursorDesc(cursor));

      const rows = await prisma.invitation.findMany({
        where: { AND: conditions },
        include: { inviter: { select: { id: true, name: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      });

      return buildPage(rows, query.limit);
    },
  };
}
