import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import { buildServer, headerGetSession } from "./helpers.js";

const BASE = "/v1/organizations/org_demo/integrations/webhooks";

const row = {
  id: "wh_1",
  name: "Ops webhook",
  endpoint: "https://customer.example.com/uptimeflow",
  secret: "whsec_abcdef0123456789abcdef01",
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
    webhookIntegration: {
      findMany: async () => [row],
      findFirst: async (args: { where: { id?: string } }) => (args.where.id === "wh_1" || !args.where.id ? row : null),
      create: async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data, id: "wh_new" }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...row, ...data }),
    },
  } as unknown as PrismaClient;
}

const dispatcher = { dispatchTest: async () => "del_test" } as unknown as IntegrationDispatcher;

const app = (role: string | null) =>
  buildServer({ prisma: prismaWithRole(role), getSession: headerGetSession, integrationDispatcher: dispatcher });

describe("webhook integration API", () => {
  it("masks the secret on list", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items[0].secretPreview).toMatch(/^••••/);
    expect(JSON.stringify(res.body)).not.toContain(row.secret);
  });

  it("generates and reveals a secret once on create", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", endpoint: "https://customer.example.com/hook" });
    expect(res.status).toBe(201);
    expect(res.body.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(res.body.secretPreview).toMatch(/^••••/);
  });

  it("accepts a customer-supplied secret", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", endpoint: "https://customer.example.com/hook", secret: "my-own-strong-secret-value" });
    expect(res.status).toBe(201);
    expect(res.body.secret).toBe("my-own-strong-secret-value");
  });

  it("rejects a non-HTTPS endpoint", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", endpoint: "http://customer.example.com/hook" });
    expect(res.status).toBe(400);
  });

  it("forbids a viewer from creating", async () => {
    const res = await request(app("viewer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", endpoint: "https://customer.example.com/hook" });
    expect(res.status).toBe(403);
  });

  it("queues a test delivery", async () => {
    const res = await request(app("developer")).post(`${BASE}/wh_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(202);
    expect(res.body.deliveryId).toBe("del_test");
  });
});
