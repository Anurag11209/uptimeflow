import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
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

function fakeChannels(): AlertChannelService {
  return {
    list: async () => ({ items: [mockChannel], nextCursor: null }),
    get: async () => mockChannel,
    create: async () => mockChannel,
    update: async () => mockChannel,
    enable: async () => mockChannel,
    disable: async () => ({ ...mockChannel, enabled: false }),
    remove: async () => true,
  };
}

function app(role: string | null) {
  return buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { channels: fakeChannels() },
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
