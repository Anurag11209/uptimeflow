import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type {
  PublicStatusIncident,
  PublicStatusPage,
  StatusPageService,
  StatusPageSummary,
} from "../src/services/status-page.service.js";

// ───────────────────────────── Fixtures ─────────────────────────────────────

const examplePage: PublicStatusPage = {
  name: "UptimeFlow Status",
  slug: "uptimeflow",
  description: "Live service status",
  branding: null,
  overallStatus: "DEGRADED_PERFORMANCE",
  components: [
    { id: "c1", name: "API", description: null, groupName: null, status: "OPERATIONAL", showUptime: true },
    { id: "c2", name: "Webhooks", description: null, groupName: null, status: "DEGRADED_PERFORMANCE", showUptime: true },
  ],
  activeIncidents: [],
  updatedAt: new Date("2026-06-16T00:00:00Z"),
};

const exampleIncident: PublicStatusIncident = {
  id: "inc_1",
  title: "Elevated error rates",
  status: "INVESTIGATING",
  impact: "MAJOR",
  startedAt: new Date("2026-06-15T00:00:00Z"),
  resolvedAt: null,
  createdAt: new Date("2026-06-15T00:00:00Z"),
  updates: [{ status: "INVESTIGATING", body: "Investigating.", createdAt: new Date("2026-06-15T00:00:00Z") }],
};

const summary: StatusPageSummary = {
  id: "sp_1",
  name: "UptimeFlow Status",
  slug: "uptimeflow",
  description: null,
  customDomain: null,
  isPublic: true,
  createdAt: new Date("2026-06-15T00:00:00Z"),
  updatedAt: new Date("2026-06-15T00:00:00Z"),
};

function fakeStatusPages(over: Partial<StatusPageService> = {}): StatusPageService {
  return {
    list: async () => ({ items: [summary], nextCursor: null }),
    get: async (_org, id) => (id === "sp_1" ? summary : null),
    create: async (_org, input) => ({ ...summary, name: input.name, slug: input.slug }),
    update: async (_org, id, input) => (id === "sp_1" ? { ...summary, ...input } : null),
    remove: async (_org, id) => id === "sp_1",
    openIncident: async (_org, pageId, input) =>
      pageId === "sp_1" ? { ...exampleIncident, title: input.title } : null,
    addIncidentUpdate: async (_org, pageId, incidentId, input) =>
      pageId === "sp_1" && incidentId === "inc_1"
        ? { ...exampleIncident, status: input.status, resolvedAt: input.status === "RESOLVED" ? new Date() : null }
        : null,
    getPublicPage: async (slug) => (slug === "uptimeflow" ? examplePage : null),
    listPublicIncidents: async (slug) =>
      slug === "uptimeflow" ? { items: [exampleIncident], nextCursor: null } : null,
    getHistory: async (slug, windowDays) =>
      slug === "uptimeflow"
        ? { windowDays, overallUptimePct: 99.98, components: [{ id: "c1", name: "API", uptimePct: 99.98, days: [] }] }
        : null,
    subscribe: async (slug, email) =>
      slug === "uptimeflow" ? { status: "pending", verificationToken: "vtok", email } : null,
    verifySubscriber: async (_slug, token) => token === "valid-token-1234567890",
    unsubscribe: async (_slug, token) => token === "valid-token-1234567890",
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

const publicApp = (over: Partial<StatusPageService> = {}) =>
  buildServer({ services: { statusPages: fakeStatusPages(over) } });

const authedApp = (role: string | null, over: Partial<StatusPageService> = {}) =>
  buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { statusPages: fakeStatusPages(over) },
  });

const ORG = "/v1/organizations/org_demo/status-pages";

// ─────────────────────────── Public surface ─────────────────────────────────

describe("public status pages", () => {
  it("GET /status/:slug returns the page or 404", async () => {
    const ok = await request(publicApp()).get("/status/uptimeflow");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ slug: "uptimeflow", overallStatus: "DEGRADED_PERFORMANCE" });
    expect(ok.body.components).toHaveLength(2);

    expect((await request(publicApp()).get("/status/missing")).status).toBe(404);
  });

  it("GET /status/:slug/incidents paginates", async () => {
    const res = await request(publicApp()).get("/status/uptimeflow/incidents");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body).toHaveProperty("nextCursor", null);
    expect((await request(publicApp()).get("/status/missing/incidents")).status).toBe(404);
  });

  it("GET /status/:slug/history returns uptime and rejects out-of-range windows", async () => {
    const res = await request(publicApp()).get("/status/uptimeflow/history?days=30");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ windowDays: 30, overallUptimePct: 99.98 });

    const bad = await request(publicApp()).get("/status/uptimeflow/history?days=120");
    expect(bad.status).toBe(400);
  });

  it("POST /status/:slug/subscribe accepts a valid email", async () => {
    const res = await request(publicApp())
      .post("/status/uptimeflow/subscribe")
      .send({ email: "fan@example.com" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending");

    const bad = await request(publicApp()).post("/status/uptimeflow/subscribe").send({ email: "nope" });
    expect(bad.status).toBe(400);

    expect(
      (await request(publicApp()).post("/status/missing/subscribe").send({ email: "fan@example.com" })).status,
    ).toBe(404);
  });

  it("reports already-active subscribers without resending", async () => {
    const app = publicApp({ subscribe: async (_s, email) => ({ status: "already_active", verificationToken: null, email }) });
    const res = await request(app).post("/status/uptimeflow/subscribe").send({ email: "fan@example.com" });
    expect(res.status).toBe(202);
    expect(res.body.status).toBe("already_active");
  });

  it("POST /status/:slug/verify and /unsubscribe accept valid tokens", async () => {
    const v = await request(publicApp()).post("/status/uptimeflow/verify").send({ token: "valid-token-1234567890" });
    expect(v.status).toBe(200);
    expect(v.body.verified).toBe(true);

    const vBad = await request(publicApp()).post("/status/uptimeflow/verify").send({ token: "wrong-token-000000" });
    expect(vBad.status).toBe(404);

    const u = await request(publicApp()).post("/status/uptimeflow/unsubscribe").send({ token: "valid-token-1234567890" });
    expect(u.status).toBe(200);
    expect(u.body.unsubscribed).toBe(true);
  });
});

// ─────────────────────────── Authed surface ─────────────────────────────────
describe("authed status page CRUD", () => {
  it("401s without a session", async () => {
    expect((await request(authedApp("viewer")).get(ORG)).status).toBe(401);
  });

  it("404s for a non-member", async () => {
    expect((await request(authedApp(null)).get(ORG).set("x-test-user", "u1")).status).toBe(404);
  });

  it("lets a viewer list (statusPage:read)", async () => {
    const res = await request(authedApp("viewer")).get(ORG).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it("forbids a viewer from creating (needs statusPage:create)", async () => {
    const res = await request(authedApp("viewer"))
      .post(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Status", slug: "acme-status" });
    expect(res.status).toBe(403);
  });

  it("lets a developer create, update and delete", async () => {
    const create = await request(authedApp("developer"))
      .post(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Status", slug: "acme-status", isPublic: true });
    expect(create.status).toBe(201);
    expect(create.body.slug).toBe("acme-status");

    const patch = await request(authedApp("developer"))
      .patch(`${ORG}/sp_1`)
      .set("x-test-user", "u1")
      .send({ name: "Renamed" });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe("Renamed");

    const del = await request(authedApp("developer")).delete(`${ORG}/sp_1`).set("x-test-user", "u1");
    expect(del.status).toBe(204);
  });

  it("rejects an invalid slug", async () => {
    const res = await request(authedApp("developer"))
      .post(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Status", slug: "Not A Slug!" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("validation_failed");
  });

  it("opens an incident and posts a resolving update", async () => {
    const open = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/incidents`)
      .set("x-test-user", "u1")
      .send({ title: "Degraded API", body: "Investigating." });
    expect(open.status).toBe(201);
    expect(open.body.title).toBe("Degraded API");

    const resolve = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/incidents/inc_1/updates`)
      .set("x-test-user", "u1")
      .send({ status: "RESOLVED", body: "Fixed." });
    expect(resolve.status).toBe(201);
    expect(resolve.body.status).toBe("RESOLVED");
  });
});
