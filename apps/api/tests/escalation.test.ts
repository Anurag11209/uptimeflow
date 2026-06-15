import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type { EscalationPolicyDetail, EscalationPolicyService } from "../src/services/escalation-policy.service.js";
import type { OnCallScheduleService, ScheduleDetail } from "../src/services/oncall.service.js";

const ORG = "/v1/organizations/org_demo";
const CHANNEL_UUID = "11111111-1111-4111-8111-111111111111";

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

const policyDetail: EscalationPolicyDetail = {
  id: "pol_1",
  name: "Default",
  description: null,
  repeatCount: 1,
  stepCount: 1,
  createdAt: new Date(),
  steps: [
    { id: "st_1", position: 0, delayMinutes: 0, targets: [{ id: "tg_1", type: "CHANNEL", userId: null, scheduleId: null, channelId: CHANNEL_UUID }] },
  ],
};

function fakePolicies(): EscalationPolicyService {
  return {
    list: async () => ({ items: [policyDetail], nextCursor: null }),
    get: async (_o, id) => (id === "pol_1" ? policyDetail : null),
    create: async () => policyDetail,
    update: async (_o, id) => (id === "pol_1" ? policyDetail : null),
    remove: async (_o, id) => id === "pol_1",
  };
}

const scheduleDetail: ScheduleDetail = {
  id: "sch_1",
  name: "Primary",
  timezone: "UTC",
  rotationType: "WEEKLY",
  handoffMinute: 540,
  participantCount: 2,
  createdAt: new Date(),
  participants: [
    { userId: "u1", position: 0, name: "Ann", email: "ann@x.test" },
    { userId: "u2", position: 1, name: "Bo", email: "bo@x.test" },
  ],
};

function fakeSchedules(): OnCallScheduleService {
  return {
    list: async () => ({ items: [scheduleDetail], nextCursor: null }),
    get: async (_o, id) => (id === "sch_1" ? scheduleDetail : null),
    create: async () => scheduleDetail,
    update: async (_o, id) => (id === "sch_1" ? scheduleDetail : null),
    remove: async (_o, id) => id === "sch_1",
    whoIsOnCall: async (_o, id) =>
      id === "sch_1"
        ? { scheduleId: "sch_1", source: "rotation", primary: { userId: "u1", name: "Ann", email: "ann@x.test" }, secondary: { userId: "u2", name: "Bo", email: "bo@x.test" } }
        : null,
    addOverride: async (_o, id) =>
      id === "sch_1" ? { id: "ov_1", userId: "u2", startsAt: new Date(), endsAt: new Date(), reason: null, createdAt: new Date() } : null,
    listOverrides: async (_o, id) => (id === "sch_1" ? [] : null),
    removeOverride: async (_o, id, ovId) => id === "sch_1" && ovId === "ov_1",
  };
}

function app(role: string | null) {
  return buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { escalationPolicies: fakePolicies(), onCallSchedules: fakeSchedules() },
  });
}

const validPolicy = {
  name: "Default",
  repeatCount: 1,
  steps: [{ delayMinutes: 0, targets: [{ type: "CHANNEL", channelId: CHANNEL_UUID }] }],
};
const validSchedule = { name: "Primary", timezone: "UTC", rotationType: "WEEKLY", handoffMinute: 540, participants: ["u1", "u2"] };

describe("escalation policy API", () => {
  it("404s for a non-member", async () => {
    const res = await request(app(null)).get(`${ORG}/escalation-policies`).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("lets a viewer list but not create", async () => {
    const list = await request(app("viewer")).get(`${ORG}/escalation-policies`).set("x-test-user", "u1");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);

    const create = await request(app("viewer")).post(`${ORG}/escalation-policies`).set("x-test-user", "u1").send(validPolicy);
    expect(create.status).toBe(403);
  });

  it("lets a developer create, fetch, update, and delete a policy", async () => {
    const create = await request(app("developer")).post(`${ORG}/escalation-policies`).set("x-test-user", "u1").send(validPolicy);
    expect(create.status).toBe(201);
    expect(create.body.steps).toHaveLength(1);

    expect((await request(app("developer")).get(`${ORG}/escalation-policies/pol_1`).set("x-test-user", "u1")).status).toBe(200);
    expect((await request(app("developer")).put(`${ORG}/escalation-policies/pol_1`).set("x-test-user", "u1").send(validPolicy)).status).toBe(200);
    expect((await request(app("developer")).delete(`${ORG}/escalation-policies/pol_1`).set("x-test-user", "u1")).status).toBe(204);
  });

  it("rejects a policy with no steps (validation)", async () => {
    const res = await request(app("developer")).post(`${ORG}/escalation-policies`).set("x-test-user", "u1").send({ name: "x", steps: [] });
    expect(res.status).toBe(400);
  });

  it("404s for an unknown policy", async () => {
    expect((await request(app("developer")).get(`${ORG}/escalation-policies/missing`).set("x-test-user", "u1")).status).toBe(404);
  });
});

describe("on-call schedule API", () => {
  it("lets a developer create a schedule and resolve who is on call", async () => {
    const create = await request(app("developer")).post(`${ORG}/oncall-schedules`).set("x-test-user", "u1").send(validSchedule);
    expect(create.status).toBe(201);

    const onCall = await request(app("developer")).get(`${ORG}/oncall-schedules/sch_1/on-call`).set("x-test-user", "u1");
    expect(onCall.status).toBe(200);
    expect(onCall.body).toMatchObject({ source: "rotation", primary: { userId: "u1" }, secondary: { userId: "u2" } });
  });

  it("manages overrides (developer add, viewer forbidden, delete)", async () => {
    const add = await request(app("developer"))
      .post(`${ORG}/oncall-schedules/sch_1/overrides`)
      .set("x-test-user", "u1")
      .send({ userId: "u2", startsAt: "2026-06-15T00:00:00Z", endsAt: "2026-06-16T00:00:00Z" });
    expect(add.status).toBe(201);

    const forbidden = await request(app("viewer"))
      .post(`${ORG}/oncall-schedules/sch_1/overrides`)
      .set("x-test-user", "u1")
      .send({ userId: "u2", startsAt: "2026-06-15T00:00:00Z", endsAt: "2026-06-16T00:00:00Z" });
    expect(forbidden.status).toBe(403);

    const del = await request(app("developer")).delete(`${ORG}/oncall-schedules/sch_1/overrides/ov_1`).set("x-test-user", "u1");
    expect(del.status).toBe(204);
  });

  it("404s resolving on-call for an unknown schedule", async () => {
    expect((await request(app("developer")).get(`${ORG}/oncall-schedules/missing/on-call`).set("x-test-user", "u1")).status).toBe(404);
  });
});
