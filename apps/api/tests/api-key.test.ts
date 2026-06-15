import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type { ApiKeyService } from "../src/services/api-key.service.js";

const ORG = "org_demo";
const ORG_PATH = `/v1/organizations/${ORG}/api-keys`;

// Tokens the fake service recognises, each with a different scope grant.
const FULL_KEY = "uf_full_scope_token"; // apiKey:* + monitor:read
const READ_ONLY_KEY = "uf_monitor_read_token"; // monitor:read only

function fakeApiKeys(): ApiKeyService {
  return {
    verify: async (token) => {
      if (token === FULL_KEY)
        return { id: "key_1", name: "CI", organizationId: ORG, scopes: ["apiKey:*", "monitor:read"] };
      if (token === READ_ONLY_KEY)
        return { id: "key_2", name: "Probe", organizationId: ORG, scopes: ["monitor:read"] };
      return null;
    },
    list: async () => [],
    create: async (input) => ({
      id: "key_new",
      name: input.name,
      prefix: "uf_abcdefgh",
      scopes: input.scopes,
      expiresAt: input.expiresAt ?? null,
      token: "uf_brand_new_plaintext_shown_once",
    }),
    revoke: async () => true,
  };
}

function mockPrisma(role = "developer"): PrismaClient {
  const org = { id: ORG, name: "Acme", slug: "acme", logo: null, createdAt: new Date("2026-01-01") };
  return {
    $queryRaw: async () => [{ ok: 1 }],
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ORG ? org : null,
    },
    member: {
      findFirst: async ({ where }: { where: { organizationId: string; userId: string } }) => ({
        id: "mem_1",
        role,
        organizationId: where.organizationId,
        userId: where.userId,
        organization: org,
      }),
    },
    apiKey: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === "key_1") return { id: "key_1", organizationId: ORG };
        if (where.id === "key_other") return { id: "key_other", organizationId: "org_other" };
        return null;
      },
    },
  } as unknown as PrismaClient;
}

function app(role?: string) {
  return buildServer({
    prisma: mockPrisma(role),
    getSession: headerGetSession,
    services: { apiKeys: fakeApiKeys() },
  });
}

describe("API key authentication", () => {
  it("authenticates a valid key and authorizes by scope", async () => {
    const res = await request(app()).get(ORG_PATH).set("x-api-key", FULL_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [] });
  });

  it("accepts the key via Authorization: Bearer too", async () => {
    const res = await request(app()).get(ORG_PATH).set("authorization", `Bearer ${FULL_KEY}`);
    expect(res.status).toBe(200);
  });

  it("401s for an invalid key", async () => {
    const res = await request(app()).get(ORG_PATH).set("x-api-key", "uf_nope");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
  });

  it("403s when the key lacks the required scope", async () => {
    const res = await request(app()).get(ORG_PATH).set("x-api-key", READ_ONLY_KEY);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("forbidden");
  });

  it("404s when a key is used against another organization (no existence leak)", async () => {
    const res = await request(app())
      .get(`/v1/organizations/org_other/api-keys`)
      .set("x-api-key", FULL_KEY);
    expect(res.status).toBe(404);
  });
});

describe("API key management (session principal)", () => {
  it("creates a key and returns the plaintext exactly once", async () => {
    const res = await request(app("developer"))
      .post(ORG_PATH)
      .set("x-test-user", "u1")
      .send({ name: "deploy bot", scopes: ["monitor:read", "monitor:create"] });
    expect(res.status).toBe(201);
    expect(res.body.token).toBe("uf_brand_new_plaintext_shown_once");
    expect(res.body.scopes).toEqual(["monitor:read", "monitor:create"]);
  });

  it("rejects unknown scopes at validation", async () => {
    const res = await request(app("developer"))
      .post(ORG_PATH)
      .set("x-test-user", "u1")
      .send({ name: "bad", scopes: ["monitor:teleport"] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("forbids a viewer from creating keys", async () => {
    const res = await request(app("viewer"))
      .post(ORG_PATH)
      .set("x-test-user", "u1")
      .send({ name: "nope", scopes: ["monitor:read"] });
    expect(res.status).toBe(403);
  });

  it("revokes a key that belongs to the org", async () => {
    const res = await request(app("developer"))
      .delete(`${ORG_PATH}/key_1`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(204);
  });

  it("404s revoking a key from another org (resource-level authz)", async () => {
    const res = await request(app("developer"))
      .delete(`${ORG_PATH}/key_other`)
      .set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });
});
