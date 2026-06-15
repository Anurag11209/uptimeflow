import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import { buildServer, headerGetSession } from "./helpers.js";

const BASE = "/v1/organizations/org_demo/integrations/discord";

const row = {
  id: "dc_1",
  name: "Ops Discord",
  webhookUrl: "https://discord.com/api/webhooks/123/secretpart",
  enabled: true,
  createdAt: new Date("2026-06-17T00:00:00Z"),
  updatedAt: new Date("2026-06-17T00:00:00Z"),
};

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
              organization: { id: args.where.organizationId, name: "Acme", slug: "acme", logo: null, createdAt: new Date() },
            }
          : null,
    },
    auditLog: { create: async () => ({}) },
    discordIntegration: {
      findMany: async () => [row],
      findFirst: async (args: { where: { id?: string } }) => (args.where.id === "dc_1" || !args.where.id ? row : null),
      create: async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data, id: "dc_new" }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }),
    },
  } as unknown as PrismaClient;
}

const dispatcher = { dispatchTest: async () => "del_test" } as unknown as IntegrationDispatcher;

const app = (role: string | null) =>
  buildServer({ prisma: prismaWithRole(role), getSession: headerGetSession, integrationDispatcher: dispatcher });

describe("discord integration API", () => {
  it("lists with masked webhook for a viewer", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items[0].webhookUrlPreview).toMatch(/^••••/);
    expect(JSON.stringify(res.body)).not.toContain("secretpart");
  });

  it("accepts a valid Discord webhook URL on create", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", webhookUrl: "https://discord.com/api/webhooks/123/abc" });
    expect(res.status).toBe(201);
  });

  it("rejects a non-Discord webhook URL", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", webhookUrl: "https://hooks.slack.com/services/T/B/C" });
    expect(res.status).toBe(400);
  });

  it("queues a test delivery", async () => {
    const res = await request(app("developer")).post(`${BASE}/dc_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(202);
    expect(res.body.deliveryId).toBe("del_test");
  });
});
