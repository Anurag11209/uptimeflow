import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer, headerGetSession } from "./helpers.js";
import {
  rangeForDays,
  type AnalyticsService,
} from "../src/services/analytics.service.js";

// ───────────────────────────── Fixtures ─────────────────────────────────────

function fakeAnalytics(over: Partial<AnalyticsService> = {}): AnalyticsService {
  return {
    summary: async (_org, range) => ({
      rangeDays: range.days,
      overallUptimePct: 99.95,
      slaCompliancePct: 99.95,
      activeMonitors: 12,
      totalMonitors: 14,
      activeIncidents: 1,
      incidentsInRange: 4,
      mttrSec: 540,
      mtbfSec: 86_400,
      avgResponseMs: 230,
      failedChecksToday: 7,
      totalChecks: 100_000,
      downtimeSec: 1_200,
    }),
    timeseries: async (_org, range) => ({
      rangeDays: range.days,
      points: [{ day: "2026-06-01", uptimePct: 100, avgResponseMs: 220, totalChecks: 1000, failedChecks: 0 }],
    }),
    regions: async (_org, range) => ({
      rangeDays: range.days,
      regions: [
        {
          region: "NA_EAST",
          avgResponseMs: 210,
          successRatePct: 99.9,
          failedChecks: 5,
          totalChecks: 5000,
          lastOutageAt: "2026-06-10",
        },
      ],
    }),
    incidents: async (_org, range) => ({
      rangeDays: range.days,
      total: 4,
      avgDurationSec: 540,
      bySeverity: [{ severity: "MAJOR", count: 3 }],
      byCause: [{ cause: "Timeout", count: 2 }],
      monthly: [{ month: "2026-06", count: 4, avgDurationSec: 540 }],
      longest: [],
    }),
    sla: async (_org, range) => ({
      rangeDays: range.days,
      slaPct: 99.95,
      downtimeSec: 1_200,
      totalIncidents: 4,
      avgRecoverySec: 540,
      monitors: [{ monitorId: "mon_1", name: "API", uptimePct: 99.9, downtimeSec: 600, incidents: 2 }],
    }),
    monitor: async (_org, monitorId, range) =>
      monitorId === "mon_1"
        ? {
            rangeDays: range.days,
            uptimePct: 99.9,
            avgResponseMs: 230,
            p95ResponseMs: 410,
            downtimeSec: 600,
            daily: [],
            regions: [],
          }
        : null,
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

const authedApp = (role: string | null, over: Partial<AnalyticsService> = {}) =>
  buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { analytics: fakeAnalytics(over) },
  });

const ORG = "/v1/organizations/org_demo/analytics";

// ───────────────────────────── rangeForDays ─────────────────────────────────

describe("rangeForDays", () => {
  it("spans the requested number of UTC days ending now", () => {
    const now = new Date("2026-06-28T12:00:00Z");
    const range = rangeForDays(30, now);
    expect(range.days).toBe(30);
    expect(range.until).toBe(now);
    // since is UTC-midnight, 29 days before today.
    expect(range.since.toISOString()).toBe("2026-05-30T00:00:00.000Z");
  });

  it("a 1-day range starts at today's UTC midnight", () => {
    const range = rangeForDays(1, new Date("2026-06-28T12:00:00Z"));
    expect(range.since.toISOString()).toBe("2026-06-28T00:00:00.000Z");
  });
});

// ───────────────────────────── Routes ───────────────────────────────────────

describe("analytics routes", () => {
  it("returns the summary for a member (monitor:read)", async () => {
    const res = await request(authedApp("viewer")).get(`${ORG}/summary`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ overallUptimePct: 99.95, activeMonitors: 12, mttrSec: 540 });
    expect(res.body.rangeDays).toBe(30);
  });

  it("honors the days query and caps it", async () => {
    const ok = await request(authedApp("viewer")).get(`${ORG}/summary?days=90`).set("x-test-user", "u1");
    expect(ok.status).toBe(200);
    expect(ok.body.rangeDays).toBe(90);

    const bad = await request(authedApp("viewer")).get(`${ORG}/summary?days=1000`).set("x-test-user", "u1");
    expect(bad.status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(authedApp("viewer")).get(`${ORG}/summary`)).status).toBe(401);
  });

  it("hides analytics from non-members (404)", async () => {
    const res = await request(authedApp(null)).get(`${ORG}/summary`).set("x-test-user", "u1");
    expect(res.status).toBe(404);
  });

  it("serves timeseries, regions, incidents and sla", async () => {
    const ts = await request(authedApp("viewer")).get(`${ORG}/timeseries`).set("x-test-user", "u1");
    expect(ts.status).toBe(200);
    expect(ts.body.points).toHaveLength(1);

    const regions = await request(authedApp("viewer")).get(`${ORG}/regions`).set("x-test-user", "u1");
    expect(regions.body.regions[0]).toMatchObject({ region: "NA_EAST", successRatePct: 99.9 });

    const incidents = await request(authedApp("viewer")).get(`${ORG}/incidents`).set("x-test-user", "u1");
    expect(incidents.body.bySeverity[0]).toMatchObject({ severity: "MAJOR", count: 3 });

    const sla = await request(authedApp("viewer")).get(`${ORG}/sla?days=90`).set("x-test-user", "u1");
    expect(sla.body).toMatchObject({ slaPct: 99.95, totalIncidents: 4 });
    expect(sla.body.monitors).toHaveLength(1);
  });

  it("returns per-monitor analytics or 404", async () => {
    const ok = await request(authedApp("viewer")).get(`${ORG}/monitors/mon_1`).set("x-test-user", "u1");
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ uptimePct: 99.9, p95ResponseMs: 410 });

    const missing = await request(authedApp("viewer")).get(`${ORG}/monitors/nope`).set("x-test-user", "u1");
    expect(missing.status).toBe(404);
  });
});
