import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import type {
  PublicStatusIncident,
  PublicStatusPage,
  StatusComponent,
  StatusPageService,
  StatusPageSummary,
  StatusSubscriber,
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
  visibility: "PUBLIC",
  isPublic: true,
  branding: null,
  createdAt: new Date("2026-06-15T00:00:00Z"),
  updatedAt: new Date("2026-06-15T00:00:00Z"),
};

const exampleComponent: StatusComponent = {
  id: "cmp_1",
  monitorId: null,
  name: "API",
  description: null,
  groupName: null,
  status: "OPERATIONAL",
  position: 0,
  showUptime: true,
  createdAt: new Date("2026-06-15T00:00:00Z"),
  updatedAt: new Date("2026-06-15T00:00:00Z"),
};

const exampleSubscriber: StatusSubscriber = {
  id: "sub_1",
  email: "ops@example.com",
  status: "ACTIVE",
  createdAt: new Date("2026-06-15T00:00:00Z"),
  verifiedAt: new Date("2026-06-15T00:00:00Z"),
  unsubscribedAt: null,
};

function fakeStatusPages(over: Partial<StatusPageService> = {}): StatusPageService {
  return {
    list: async () => ({ items: [summary], nextCursor: null }),
    get: async (_org, id) => (id === "sp_1" ? summary : null),
    create: async (_org, input) => ({ ...summary, name: input.name, slug: input.slug }),
    update: async (_org, id, input) => (id === "sp_1" ? { ...summary, ...input } : null),
    remove: async (_org, id) => id === "sp_1",
    listComponents: async (_org, pageId) => (pageId === "sp_1" ? [exampleComponent] : null),
    createComponent: async (_org, pageId, input) =>
      pageId === "sp_1" ? { ...exampleComponent, name: input.name } : null,
    updateComponent: async (_org, pageId, componentId, input) =>
      pageId === "sp_1" && componentId === "cmp_1"
        ? { ...exampleComponent, ...input }
        : null,
    deleteComponent: async (_org, pageId, componentId) =>
      pageId === "sp_1" && componentId === "cmp_1",
    reorderComponents: async (_org, pageId, orderedIds) =>
      pageId === "sp_1"
        ? orderedIds.map((id, i) => ({ ...exampleComponent, id, position: i }))
        : null,
    listIncidents: async (_org, pageId) =>
      pageId === "sp_1" ? { items: [exampleIncident], nextCursor: null } : null,
    listSubscribers: async (_org, pageId) =>
      pageId === "sp_1"
        ? {
            items: [exampleSubscriber],
            nextCursor: null,
            counts: { total: 1, active: 1, pending: 0, unsubscribed: 0 },
          }
        : null,
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

  it("accepts a tri-state visibility and branding on create", async () => {
    const res = await request(authedApp("developer"))
      .post(ORG)
      .set("x-test-user", "u1")
      .send({
        name: "Branded",
        slug: "branded",
        visibility: "UNLISTED",
        branding: { accent: "#2fd180", footerText: "© Acme" },
      });
    expect(res.status).toBe(201);
  });

  it("rejects a non-hex accent color", async () => {
    const res = await request(authedApp("developer"))
      .post(ORG)
      .set("x-test-user", "u1")
      .send({ name: "Bad", slug: "bad", branding: { accent: "red" } });
    expect(res.status).toBe(400);
  });
});

describe("status page components, subscribers & incident list", () => {
  it("lists components for a page (404 for unknown page)", async () => {
    const res = await request(authedApp("viewer")).get(`${ORG}/sp_1/components`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: "cmp_1", name: "API" });

    const missing = await request(authedApp("viewer"))
      .get(`${ORG}/nope/components`)
      .set("x-test-user", "u1");
    expect(missing.status).toBe(404);
  });

  it("requires statusPage:update to create a component", async () => {
    const forbidden = await request(authedApp("viewer"))
      .post(`${ORG}/sp_1/components`)
      .set("x-test-user", "u1")
      .send({ name: "Webhooks" });
    expect(forbidden.status).toBe(403);

    const ok = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/components`)
      .set("x-test-user", "u1")
      .send({ name: "Webhooks" });
    expect(ok.status).toBe(201);
    expect(ok.body.name).toBe("Webhooks");
  });

  it("validates the component status enum", async () => {
    const res = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/components`)
      .set("x-test-user", "u1")
      .send({ name: "X", status: "ON_FIRE" });
    expect(res.status).toBe(400);
  });

  it("updates and deletes a component", async () => {
    const patch = await request(authedApp("developer"))
      .patch(`${ORG}/sp_1/components/cmp_1`)
      .set("x-test-user", "u1")
      .send({ status: "MAJOR_OUTAGE" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("MAJOR_OUTAGE");

    const del = await request(authedApp("developer"))
      .delete(`${ORG}/sp_1/components/cmp_1`)
      .set("x-test-user", "u1");
    expect(del.status).toBe(204);

    const delMissing = await request(authedApp("developer"))
      .delete(`${ORG}/sp_1/components/zzz`)
      .set("x-test-user", "u1");
    expect(delMissing.status).toBe(404);
  });

  it("reorders components", async () => {
    const id1 = "11111111-1111-4111-8111-111111111111";
    const id2 = "22222222-2222-4222-8222-222222222222";
    const res = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/components/reorder`)
      .set("x-test-user", "u1")
      .send({ orderedIds: [id2, id1] });
    expect(res.status).toBe(200);
    expect(res.body.items.map((c: { id: string }) => c.id)).toEqual([id2, id1]);
  });

  it("rejects an empty reorder payload", async () => {
    const res = await request(authedApp("developer"))
      .post(`${ORG}/sp_1/components/reorder`)
      .set("x-test-user", "u1")
      .send({ orderedIds: [] });
    expect(res.status).toBe(400);
  });

  it("lists subscribers with counts", async () => {
    const res = await request(authedApp("viewer")).get(`${ORG}/sp_1/subscribers`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.counts).toMatchObject({ total: 1, active: 1 });
    expect(res.body.items[0].email).toBe("ops@example.com");
  });

  it("lists all incidents for a page (authed)", async () => {
    const res = await request(authedApp("viewer")).get(`${ORG}/sp_1/incidents`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});
