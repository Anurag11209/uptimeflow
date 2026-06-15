import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import type { IntegrationDispatcher } from "@backend-uptime/monitoring";
import { buildServer, headerGetSession } from "./helpers.js";

const BASE = "/v1/organizations/org_demo/integrations/slack";

const slackRow = {
  id: "sl_1",
  name: "Ops Slack",
  webhookUrl: "https://hooks.slack.com/services/T000/B000/secretpart",
  enabled: true,
  createdAt: new Date("2026-06-17T00:00:00Z"),
  updatedAt: new Date("2026-06-17T00:00:00Z"),
};

/** Prisma double: membership for orgContext + a slackIntegration delegate. */
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
    auditLog: { create: async () => ({}) },
    slackIntegration: {
      findMany: async () => [slackRow],
      findFirst: async (args: { where: { id?: string } }) => (args.where.id === "sl_1" || !args.where.id ? slackRow : null),
      create: async ({ data }: { data: Record<string, unknown> }) => ({ ...slackRow, ...data, id: "sl_new" }),
      update: async ({ data }: { data: Record<string, unknown> }) => ({ ...slackRow, ...data }),
    },
  } as unknown as PrismaClient;
}

const dispatcher = {
  dispatchIncident: async () => 0,
  dispatchEvent: async () => 0,
  dispatchTest: async () => "del_test",
} as unknown as IntegrationDispatcher;

function app(role: string | null, withDispatcher = true) {
  return buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    integrationDispatcher: withDispatcher ? dispatcher : undefined,
  });
}

describe("slack integration API", () => {
  it("401s without a session", async () => {
    expect((await request(app("viewer")).get(BASE)).status).toBe(401);
  });

  it("404s for a non-member (no existence leak)", async () => {
    expect((await request(app(null)).get(BASE).set("x-test-user", "u1")).status).toBe(404);
  });

  it("lets a viewer list, masking the webhook secret", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].webhookUrlPreview).toMatch(/^••••/);
    expect(JSON.stringify(res.body)).not.toContain("secretpart");
  });

  it("forbids a viewer from creating (needs alertChannel:create)", async () => {
    const res = await request(app("viewer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", webhookUrl: "https://hooks.slack.com/services/T/B/C" });
    expect(res.status).toBe(403);
  });

  it("lets a developer create with a valid Slack URL", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", webhookUrl: "https://hooks.slack.com/services/T/B/C" });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Ops");
  });

  it("rejects a non-Slack webhook URL", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Ops", webhookUrl: "https://evil.example.com/hook" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("updates and soft-deletes an integration", async () => {
    const patch = await request(app("developer"))
      .patch(`${BASE}/sl_1`)
      .set("x-test-user", "u1")
      .send({ enabled: false });
    expect(patch.status).toBe(200);
    expect(patch.body.enabled).toBe(false);

    const del = await request(app("developer")).delete(`${BASE}/sl_1`).set("x-test-user", "u1");
    expect(del.status).toBe(204);
  });

  it("queues a test delivery", async () => {
    const res = await request(app("developer")).post(`${BASE}/sl_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ queued: true, deliveryId: "del_test" });
  });

  it("returns 503 for a test when delivery is not configured", async () => {
    const res = await request(app("developer", false)).post(`${BASE}/sl_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(503);
  });
});
