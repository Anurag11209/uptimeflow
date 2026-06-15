import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import type { Page } from "@backend-uptime/shared";
import { buildServer, headerGetSession } from "./helpers.js";
import type {
  InvitationListItem,
  MemberListItem,
  MemberService,
} from "../src/services/member.service.js";

const emptyPage: Page<never> = { items: [], nextCursor: null };

function prismaWithMembership(role: string | null): PrismaClient {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    member: {
      findFirst: async (args: { where: { organizationId: string; userId: string } }) =>
        role
          ? {
              id: "mem_1",
              role,
              organizationId: args.where.organizationId,
              userId: args.where.userId,
              organization: {
                id: args.where.organizationId,
                name: "Acme",
                slug: "acme",
                logo: null,
                createdAt: new Date("2026-01-01T00:00:00Z"),
              },
            }
          : null,
      findMany: async () => [],
    },
  } as unknown as PrismaClient;
}

const fakeMembers: MemberService = {
  listMembers: async () => emptyPage as Page<MemberListItem>,
  listInvitations: async () => emptyPage as Page<InvitationListItem>,
};

function appWithRole(role: string | null) {
  return buildServer({
    prisma: prismaWithMembership(role),
    getSession: headerGetSession,
    services: {
      members: fakeMembers,
      auditLogs: { log: async () => {}, list: async () => emptyPage },
      orgStats: {
        getOverview: async () => ({
          members: 3,
          pendingInvitations: 1,
          monitors: 0,
          openIncidents: 0,
          auditEventsLast30d: 12,
        }),
      },
    },
  });
}

const ORG = "/v1/organizations/org_demo";

describe("organization RBAC", () => {
  it("404s for non-members (no existence leak)", async () => {
    const res = await request(appWithRole(null)).get(`${ORG}/members`).set("x-test-user", "u1");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("401s without a session", async () => {
    const res = await request(appWithRole("admin")).get(`${ORG}/members`);
    expect(res.status).toBe(401);
  });

  it.each(["owner", "admin", "manager", "viewer"])(
    "allows %s to list members",
    async (role) => {
      const res = await request(appWithRole(role)).get(`${ORG}/members`).set("x-test-user", "u1");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(emptyPage);
    },
  );

  it("forbids developer role from reading the member list", async () => {
    const res = await request(appWithRole("developer"))
      .get(`${ORG}/members`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("forbids developer role from reading audit logs", async () => {
    const res = await request(appWithRole("developer"))
      .get(`${ORG}/audit-logs`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });

  it("allows owner to read audit logs", async () => {
    const res = await request(appWithRole("owner"))
      .get(`${ORG}/audit-logs`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(200);
  });

  it("rejects unknown roles defensively", async () => {
    const res = await request(appWithRole("superuser"))
      .get(`${ORG}/members`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });

  it("returns overview with role + stats for viewer", async () => {
    const res = await request(appWithRole("viewer"))
      .get(`${ORG}/overview`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("viewer");
    expect(res.body.stats.members).toBe(3);
    expect(res.body.organization.slug).toBe("acme");
  });

  it("rejects invalid pagination query with 400 + details", async () => {
    const res = await request(appWithRole("owner"))
      .get(`${ORG}/members?limit=5000`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
    expect(res.body.error.details).toBeTruthy();
  });
});
