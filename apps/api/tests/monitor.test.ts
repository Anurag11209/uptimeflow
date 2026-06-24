import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type { MonitorService, MonitorDetail } from "../src/services/monitor.service.js";

const BASE = "/v1/organizations/org_demo/monitors";

function prismaWithRole(role: string | null): PrismaClient {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    member: {
      findFirst: async (args: { where: { organizationId: string; userId: string } }) =>
        role
          ? { role, organizationId: args.where.organizationId, userId: args.where.userId }
          : null,
    },
  } as unknown as PrismaClient;
}

const mockMonitor: MonitorDetail = {
  id: "mon_1",
  name: "API Monitor",
  type: "HTTP",
  state: "ACTIVE",
  health: "UP",
  url: "https://example.com",
  host: null,
  port: null,
  intervalSeconds: 60,
  groupId: null,
  groupName: null,
  lastCheckedAt: new Date(),
  lastResponseMs: 120,
  lastStatusCode: 200,
  lastError: null,
  escalationPolicyId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  httpMethod: "GET",
  requestHeaders: null,
  requestBody: null,
  expectedStatus: 200,
  keyword: null,
  keywordInverted: false,
  followRedirects: true,
  verifySsl: true,
  timeoutSeconds: 30,
  retries: 2,
  regions: ["NA_EAST"],
  failureThreshold: 3,
  successThreshold: 1,
  consecutiveFailures: 0,
  consecutiveSuccesses: 10,
  assertions: [],
  boundChannelIds: [],
};

function fakeMonitors(): MonitorService {
  return {
    list: async () => ({ items: [mockMonitor], nextCursor: null }),
    get: async () => mockMonitor,
    create: async () => mockMonitor,
    update: async () => mockMonitor,
    remove: async () => true,
    pause: async () => ({ ...mockMonitor, state: "PAUSED" }),
    resume: async () => mockMonitor,
    listCheckResults: async () => ({ items: [], nextCursor: null }),
    listMaintenanceWindows: async () => [],
    setChannels: async (_o, _m, ids) => ids,
  };
}

function app(role: string | null) {
  return buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { monitors: fakeMonitors() },
  });
}

describe("monitor API", () => {
  it("401s without a session", async () => {
    expect((await request(app("owner")).get(BASE)).status).toBe(401);
  });

  it("404s for a non-member (existence privacy)", async () => {
    const res = await request(app(null)).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("lets a member (monitor:read) list monitors", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("lets an admin create a monitor", async () => {
    const res = await request(app("admin"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "New", type: "HTTP", url: "https://a.com" });
    expect(res.status).toBe(201);
  });

  it("fails validation for bad monitor types", async () => {
    const res = await request(app("admin"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ name: "Bad", type: "INVALID_TYPE" });
    expect(res.status).toBe(400); // Caught by Zod inside monitor.ts router
  });
});
