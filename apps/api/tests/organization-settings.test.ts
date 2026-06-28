import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type {
  OrgSettings,
  OrgSettingsService,
} from "../src/services/organization-settings.service.js";

const settings: OrgSettings = {
  id: "org_demo",
  name: "Acme",
  slug: "acme",
  logo: null,
  timezone: "UTC",
  billingContact: "billing@acme.com",
  defaultRegion: "EU_WEST",
  defaultAlertPolicyId: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function fakeOrgSettings(over: Partial<OrgSettingsService> = {}): OrgSettingsService {
  return {
    get: async (orgId) => (orgId === "org_demo" ? settings : null),
    update: async (orgId, input) =>
      orgId === "org_demo" ? { ...settings, ...input } : null,
    ...over,
  };
}

function prismaWithRole(role: string | null): PrismaClient {
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
    },
  } as unknown as PrismaClient;
}

const authedApp = (role: string | null, over: Partial<OrgSettingsService> = {}) =>
  buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { orgSettings: fakeOrgSettings(over) },
  });

const ORG = "/v1/organizations/org_demo/settings";

describe("organization settings", () => {
  it("returns settings for any member (organization:read)", async () => {
    const res = await request(authedApp("viewer")).get(ORG).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ slug: "acme", timezone: "UTC", defaultRegion: "EU_WEST" });
  });

  it("requires authentication", async () => {
    expect((await request(authedApp("admin")).get(ORG)).status).toBe(401);
  });

  it("hides settings from non-members (404)", async () => {
    expect((await request(authedApp(null)).get(ORG).set("x-test-user", "u1")).status).toBe(404);
  });

  it("forbids a viewer from updating (needs organization:update)", async () => {
    const res = await request(authedApp("viewer"))
      .patch(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(403);
  });

  it("forbids a manager from updating (read-only on org)", async () => {
    const res = await request(authedApp("manager"))
      .patch(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Renamed" });
    expect(res.status).toBe(403);
  });

  it("lets an admin update name + metadata fields", async () => {
    const res = await request(authedApp("admin"))
      .patch(ORG)
      .set("x-test-user", "u1")
      .send({ name: "New Name", timezone: "America/New_York", defaultRegion: "NA_EAST" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "New Name", timezone: "America/New_York", defaultRegion: "NA_EAST" });
  });

  it("rejects an invalid slug", async () => {
    const res = await request(authedApp("owner"))
      .patch(ORG)
      .set("x-test-user", "u1")
      .send({ slug: "Not A Slug" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed billing contact email", async () => {
    const res = await request(authedApp("owner"))
      .patch(ORG)
      .set("x-test-user", "u1")
      .send({ billingContact: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects an empty patch", async () => {
    const res = await request(authedApp("owner")).patch(ORG).set("x-test-user", "u1").send({});
    expect(res.status).toBe(400);
  });
});
