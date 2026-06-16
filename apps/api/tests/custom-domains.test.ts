import { describe, expect, it, beforeEach } from "vitest";
import request from "supertest";
import { Prisma, type PrismaClient } from "@backend-uptime/db";
import {
  createCustomDomainService,
  type CustomDomainService,
  type DnsResolver,
} from "../src/services/custom-domain.service.js";
import { buildServer, headerGetSession } from "./helpers.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

interface DomainRow {
  id: string;
  organizationId: string;
  statusPageId: string;
  domain: string;
  verificationStatus: string;
  verificationToken: string;
  sslStatus: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  lastCheckError: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

function fakePrisma(opts: { statusPageIds?: string[] } = {}) {
  const rows = new Map<string, DomainRow>();
  const byDomain = new Map<string, string>(); // domain -> id (active only)
  const statusPageIds = new Set(opts.statusPageIds ?? ["page_1"]);
  let seq = 0;

  const prisma = {
    statusPage: {
      findFirst: async ({ where }: { where: { id: string; organizationId: string } }) =>
        statusPageIds.has(where.id) ? { id: where.id } : null,
    },
    customDomain: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const domain = data.domain as string;
        if (byDomain.has(domain)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
        const id = `cd_${++seq}`;
        const now = new Date("2026-06-17T00:00:00Z");
        const row: DomainRow = {
          id,
          organizationId: data.organizationId as string,
          statusPageId: data.statusPageId as string,
          domain,
          verificationStatus: "PENDING",
          verificationToken: data.verificationToken as string,
          sslStatus: "PENDING",
          verifiedAt: null,
          lastCheckedAt: null,
          lastCheckError: null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        rows.set(id, row);
        byDomain.set(domain, id);
        return row;
      },
      findFirst: async ({ where }: { where: { id?: string; organizationId?: string } }) => {
        for (const r of rows.values()) {
          if (
            (!where.id || r.id === where.id) &&
            (!where.organizationId || r.organizationId === where.organizationId) &&
            r.deletedAt === null
          ) {
            return r;
          }
        }
        return null;
      },
      findMany: async () => [...rows.values()].filter((r) => r.deletedAt === null),
      update: async ({ where, data }: { where: { id: string }; data: Partial<DomainRow> }) => {
        const row = rows.get(where.id)!;
        Object.assign(row, data);
        if (row.deletedAt) byDomain.delete(row.domain);
        return row;
      },
    },
    auditLog: { create: async () => ({}) },
  } as unknown as PrismaClient;

  return { prisma, rows };
}

/** Mutable DNS fake: set `txt[hostname]` to records, or `errors[hostname]`. */
function fakeDns() {
  const txt: Record<string, string[][]> = {};
  const errors: Record<string, { code?: string }> = {};
  const resolver: DnsResolver = {
    resolveTxt: async (hostname) => {
      if (errors[hostname]) throw Object.assign(new Error("dns"), errors[hostname]);
      return txt[hostname] ?? [];
    },
  };
  return { resolver, txt, errors };
}

const actor = { userId: "u1", actorType: "user" as const };

function makeService(dns: DnsResolver, prisma: PrismaClient): CustomDomainService {
  return createCustomDomainService({ prisma, dns, cnameTarget: "cname.uptimeflow.app" });
}

// ── Service: create + validation ─────────────────────────────────────────────

describe("custom domain service — create", () => {
  it("normalizes the domain and returns DNS instructions", async () => {
    const { prisma } = fakePrisma();
    const svc = makeService(fakeDns().resolver, prisma);
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "HTTPS://Status.Acme.com/" }, actor);
    expect(d.domain).toBe("status.acme.com");
    expect(d.verificationStatus).toBe("PENDING");
    expect(d.dns.txtRecord.name).toBe("_uptimeflow-challenge.status.acme.com");
    expect(d.dns.cnameRecord.value).toBe("cname.uptimeflow.app");
    expect(d.dns.txtRecord.value).toMatch(/^[0-9a-f]{48}$/); // generated token
  });

  it("rejects an invalid domain with validation_failed", async () => {
    const { prisma } = fakePrisma();
    const svc = makeService(fakeDns().resolver, prisma);
    await expect(svc.create("org_1", { statusPageId: "page_1", domain: "nope" }, actor)).rejects.toMatchObject({
      code: "validation_failed",
    });
  });

  it("404s when the status page is not in the org", async () => {
    const { prisma } = fakePrisma({ statusPageIds: ["page_1"] });
    const svc = makeService(fakeDns().resolver, prisma);
    await expect(
      svc.create("org_1", { statusPageId: "other_page", domain: "status.acme.com" }, actor),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("conflicts when the domain is already connected", async () => {
    const { prisma } = fakePrisma();
    const svc = makeService(fakeDns().resolver, prisma);
    await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    await expect(
      svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor),
    ).rejects.toMatchObject({ code: "conflict" });
  });
});

// ── Service: verification flow ───────────────────────────────────────────────

describe("custom domain service — verify", () => {
  let dns: ReturnType<typeof fakeDns>;
  let prisma: PrismaClient;
  let svc: CustomDomainService;

  beforeEach(() => {
    dns = fakeDns();
    prisma = fakePrisma().prisma;
    svc = makeService(dns.resolver, prisma);
  });

  it("PENDING → VERIFIED when the TXT token matches", async () => {
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    const token = d.dns.txtRecord.value;
    dns.txt["_uptimeflow-challenge.status.acme.com"] = [[token]];
    const v = await svc.verify("org_1", d.id);
    expect(v!.verificationStatus).toBe("VERIFIED");
    expect(v!.verifiedAt).not.toBeNull();
    expect(v!.lastCheckError).toBeNull();
  });

  it("FAILED when a TXT record exists but does not match", async () => {
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    dns.txt["_uptimeflow-challenge.status.acme.com"] = [["some-other-value"]];
    const v = await svc.verify("org_1", d.id);
    expect(v!.verificationStatus).toBe("FAILED");
    expect(v!.lastCheckError).toMatch(/did not match/i);
  });

  it("stays PENDING (graceful) on NXDOMAIN / not yet propagated", async () => {
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    dns.errors["_uptimeflow-challenge.status.acme.com"] = { code: "ENOTFOUND" };
    const v = await svc.verify("org_1", d.id);
    expect(v!.verificationStatus).toBe("PENDING");
    expect(v!.lastCheckError).toMatch(/propagat/i);
    expect(v!.lastCheckedAt).not.toBeNull();
  });

  it("re-verifying a propagated domain is idempotent (stays VERIFIED)", async () => {
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    dns.txt["_uptimeflow-challenge.status.acme.com"] = [[d.dns.txtRecord.value]];
    await svc.verify("org_1", d.id);
    const again = await svc.verify("org_1", d.id);
    expect(again!.verificationStatus).toBe("VERIFIED");
  });

  it("verify returns null for an unknown id", async () => {
    expect(await svc.verify("org_1", "missing")).toBeNull();
  });

  it("TXT records split into chunks are joined before comparison", async () => {
    const d = await svc.create("org_1", { statusPageId: "page_1", domain: "status.acme.com" }, actor);
    const token = d.dns.txtRecord.value;
    dns.txt["_uptimeflow-challenge.status.acme.com"] = [[token.slice(0, 20), token.slice(20)]];
    const v = await svc.verify("org_1", d.id);
    expect(v!.verificationStatus).toBe("VERIFIED");
  });
});

// ── Routes: RBAC + lifecycle ─────────────────────────────────────────────────

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
                createdAt: new Date(),
              },
            }
          : null,
    },
  } as unknown as PrismaClient;
}

const summary = {
  id: "cd_1",
  statusPageId: "page_1",
  domain: "status.acme.com",
  verificationStatus: "PENDING",
  sslStatus: "PENDING",
  verifiedAt: null,
  lastCheckedAt: null,
  lastCheckError: null,
  createdAt: new Date("2026-06-17T00:00:00Z"),
  updatedAt: new Date("2026-06-17T00:00:00Z"),
  dns: {
    txtRecord: { type: "TXT", name: "_uptimeflow-challenge.status.acme.com", value: "tok" },
    cnameRecord: { type: "CNAME", name: "status.acme.com", value: "cname.uptimeflow.app" },
  },
};

const fakeService: CustomDomainService = {
  list: async () => ({ items: [summary as never], nextCursor: null }),
  get: async () => summary as never,
  create: async () => summary as never,
  verify: async () => ({ ...summary, verificationStatus: "VERIFIED" }) as never,
  remove: async () => true,
};

const BASE = "/v1/organizations/org_demo/custom-domains";
const app = (role: string | null) =>
  buildServer({ prisma: prismaWithRole(role), getSession: headerGetSession, services: { customDomains: fakeService } });

describe("custom domains routes RBAC", () => {
  it("viewer can list (statusPage:read)", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.items[0].domain).toBe("status.acme.com");
  });

  it("viewer cannot create (no statusPage:create)", async () => {
    const res = await request(app("viewer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ statusPageId: "11111111-1111-1111-1111-111111111111", domain: "status.acme.com" });
    expect(res.status).toBe(403);
  });

  it("developer can create (201)", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ statusPageId: "11111111-1111-1111-1111-111111111111", domain: "status.acme.com" });
    expect(res.status).toBe(201);
  });

  it("rejects an invalid statusPageId with 400", async () => {
    const res = await request(app("developer"))
      .post(BASE)
      .set("x-test-user", "u1")
      .send({ statusPageId: "not-a-uuid", domain: "status.acme.com" });
    expect(res.status).toBe(400);
  });

  it("developer can verify (200)", async () => {
    const res = await request(app("developer")).post(`${BASE}/cd_1/verify`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.verificationStatus).toBe("VERIFIED");
  });

  it("developer can delete (204)", async () => {
    const res = await request(app("developer")).delete(`${BASE}/cd_1`).set("x-test-user", "u1");
    expect(res.status).toBe(204);
  });
});
