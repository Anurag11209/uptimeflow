import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type { IncidentDetail, IncidentService } from "../src/services/incident.service.js";

const BASE = "/v1/organizations/org_demo/incidents";

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

const detail: IncidentDetail = {
  id: "inc_1",
  status: "OPEN",
  severity: "MAJOR",
  title: "API is down",
  summary: "connect refused",
  monitorId: "mon_1",
  monitorName: "Acme API",
  startedAt: new Date("2026-06-15T00:00:00Z"),
  acknowledgedAt: null,
  resolvedAt: null,
  durationSec: null,
  createdAt: new Date("2026-06-15T00:00:00Z"),
  cause: "connect",
  acknowledgedById: null,
  events: [
    { id: "ev_1", type: "DETECTED", message: "refused", actorId: null, metadata: null, createdAt: new Date() },
  ],
};

function fakeIncidents(over: Partial<IncidentService> = {}): IncidentService {
  return {
    list: async () => ({ items: [detail], nextCursor: null }),
    get: async (_org, id) => (id === "inc_1" ? detail : null),
    acknowledge: async (_org, id) => (id === "inc_1" ? { ...detail, status: "ACKNOWLEDGED" } : null),
    resolve: async (_org, id) => (id === "inc_1" ? { ...detail, status: "RESOLVED" } : null),
    comment: async (_org, id, message, actor) =>
      id === "inc_1"
        ? { id: "ev_2", type: "COMMENT", message, actorId: actor.userId, metadata: null, createdAt: new Date() }
        : null,
    ...over,
  };
}

function app(role: string | null, incidents: IncidentService = fakeIncidents()) {
  return buildServer({ prisma: prismaWithRole(role), getSession: headerGetSession, services: { incidents } });
}

describe("incident API", () => {
  it("401s without a session", async () => {
    expect((await request(app("viewer")).get(BASE)).status).toBe(401);
  });

  it("404s for a non-member (no existence leak)", async () => {
    const res = await request(app(null)).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("lets a viewer (monitor:read) list and view incidents", async () => {
    const list = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);

    const get = await request(app("viewer")).get(`${BASE}/inc_1`).set("x-test-user", "u1");
    expect(get.status).toBe(200);
    expect(get.body.events).toHaveLength(1);
  });

  it("404s for an unknown incident", async () => {
    const res = await request(app("viewer")).get(`${BASE}/missing`).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("forbids a viewer from acknowledging (needs monitor:update)", async () => {
    const res = await request(app("viewer")).post(`${BASE}/inc_1/acknowledge`).set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });

  it("lets a developer acknowledge and resolve", async () => {
    const ack = await request(app("developer")).post(`${BASE}/inc_1/acknowledge`).set("x-test-user", "u1");
    expect(ack.status).toBe(200);
    expect(ack.body.status).toBe("ACKNOWLEDGED");

    const resolve = await request(app("developer")).post(`${BASE}/inc_1/resolve`).set("x-test-user", "u1");
    expect(resolve.status).toBe(200);
    expect(resolve.body.status).toBe("RESOLVED");
  });

  it("adds a comment and rejects an empty one", async () => {
    const ok = await request(app("developer"))
      .post(`${BASE}/inc_1/comment`)
      .set("x-test-user", "u1")
      .send({ message: "Looking into it." });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ type: "COMMENT", message: "Looking into it." });

    const bad = await request(app("developer"))
      .post(`${BASE}/inc_1/comment`)
      .set("x-test-user", "u1")
      .send({ message: "" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("validation_failed");
  });
});
