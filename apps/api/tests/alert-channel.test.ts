import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { AppError } from "@backend-uptime/shared";
import { buildServer, headerGetSession } from "./helpers.js";
import type {
  AlertChannelService,
  AlertChannelDetail,
} from "../src/services/alert-channel.service.js";

const BASE = "/v1/organizations/org_demo/alert-channels";

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

const mockChannel: AlertChannelDetail = {
  id: "chan_1",
  type: "EMAIL",
  name: "Ops Team Email",
  config: { email: "ops@example.com" },
  enabled: true,
  verifiedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  boundMonitorIds: ["mon_1"],
};

const VERIFIED_AT = new Date("2026-08-08T10:00:00.000Z");

function fakeChannels(overrides: Partial<AlertChannelService> = {}): AlertChannelService {
  return {
    list: async () => ({ items: [mockChannel], nextCursor: null }),
    get: async () => mockChannel,
    create: async () => mockChannel,
    update: async () => mockChannel,
    enable: async () => mockChannel,
    disable: async () => ({ ...mockChannel, enabled: false }),
    remove: async () => true,
    test: async () => ({ ok: true, verifiedAt: VERIFIED_AT }),
    ...overrides,
  };
}

function app(role: string | null, channels: AlertChannelService = fakeChannels()) {
  return buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { channels },
  });
}

describe("alert channel API", () => {
  it("401s without a session", async () => {
    expect((await request(app("owner")).get(BASE)).status).toBe(401);
  });

  it("lets a member list alert channels", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items[0].name).toBe("Ops Team Email");
  });

  it("lets an admin create a channel", async () => {
    const res = await request(app("admin"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ type: "EMAIL", name: "New Email", config: { email: "test@example.com" } });
    expect(res.status).toBe(201);
  });

  it("lets an admin disable a channel", async () => {
    const res = await request(app("admin")).post(`${BASE}/chan_1/disable`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });
});

describe("POST /:channelId/test", () => {
  it("401s without a session", async () => {
    expect((await request(app("owner")).post(`${BASE}/chan_1/test`)).status).toBe(401);
  });

  it("403s for a viewer (needs the update permission)", async () => {
    const res = await request(app("viewer")).post(`${BASE}/chan_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });

  it("returns the send result for an admin", async () => {
    const res = await request(app("admin")).post(`${BASE}/chan_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, verifiedAt: VERIFIED_AT.toISOString() });
  });

  it("404s for an unknown channel", async () => {
    const channels = fakeChannels({ test: async () => null });
    const res = await request(app("admin", channels)).post(`${BASE}/ghost/test`).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("passes the provider's rejection through to the client", async () => {
    const channels = fakeChannels({
      test: async () => {
        throw new AppError("bad_request", "Slack rejected the test message (HTTP 404): no_service");
      },
    });
    const res = await request(app("admin", channels)).post(`${BASE}/chan_1/test`).set("x-test-user", "u1");
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain("no_service");
  });
});
