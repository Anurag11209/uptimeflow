import { randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import {
  AppError,
  buildPage,
  buildDnsInstructions,
  challengeHostname,
  normalizeDomain,
  type DnsInstructions,
  type Page,
} from "@backend-uptime/shared";
import { Prisma, type PrismaClient } from "@backend-uptime/db";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

/** Injectable DNS seam — node's resolver in prod, a fake in tests. */
export interface DnsResolver {
  /** Resolve TXT records; each record is an array of string chunks. */
  resolveTxt(hostname: string): Promise<string[][]>;
}

export const nodeDnsResolver: DnsResolver = {
  resolveTxt: (hostname) => dns.resolveTxt(hostname),
};

export interface CustomDomainActor {
  userId: string | null;
  actorType: "user" | "api_key";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface CustomDomainSummary {
  id: string;
  statusPageId: string;
  domain: string;
  verificationStatus: string;
  sslStatus: string;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  lastCheckError: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** The DNS records the customer must add (TXT challenge + routing CNAME). */
  dns: DnsInstructions;
}

export interface CreateCustomDomainInput {
  statusPageId: string;
  domain: string;
}

export interface ListQuery {
  limit: number;
  cursor?: string;
}

export interface ResolvedDomain {
  organizationId: string;
  statusPageId: string;
  domain: string;
}

export interface CustomDomainService {
  list(organizationId: string, query: ListQuery): Promise<Page<CustomDomainSummary>>;
  get(organizationId: string, id: string): Promise<CustomDomainSummary | null>;
  /**
   * Resolve an inbound hostname to its status page. Returns null for unknown,
   * unverified, or soft-deleted domains — the caller (edge serving / TLS
   * authorize) must treat null as "reject". Not org-scoped: it IS the lookup
   * that establishes the tenant from the hostname.
   */
  resolve(host: string): Promise<ResolvedDomain | null>;
  create(
    organizationId: string,
    input: CreateCustomDomainInput,
    actor: CustomDomainActor,
  ): Promise<CustomDomainSummary>;
  /** Run a DNS check and update verification status. Never throws on DNS errors. */
  verify(organizationId: string, id: string): Promise<CustomDomainSummary | null>;
  remove(organizationId: string, id: string, actor: CustomDomainActor): Promise<boolean>;
}

export interface CustomDomainServiceDeps {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  dns?: DnsResolver;
  /** Edge target customers CNAME to (e.g. "cname.uptimeflow.app"). */
  cnameTarget: string;
  challengePrefix?: string;
  /** Optional capability gate (wired in Phase 11D); no-op when absent. */
  assertCanUseCustomDomains?: (organizationId: string) => Promise<void>;
}

type Row = {
  id: string;
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
};

export function createCustomDomainService(deps: CustomDomainServiceDeps): CustomDomainService {
  const { prisma, auditLogs } = deps;
  const resolver = deps.dns ?? nodeDnsResolver;

  const SELECT = {
    id: true,
    statusPageId: true,
    domain: true,
    verificationStatus: true,
    verificationToken: true,
    sslStatus: true,
    verifiedAt: true,
    lastCheckedAt: true,
    lastCheckError: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  function toSummary(row: Row): CustomDomainSummary {
    const { verificationToken, ...rest } = row;
    return {
      ...rest,
      dns: buildDnsInstructions({
        domain: row.domain,
        token: verificationToken,
        cnameTarget: deps.cnameTarget,
        challengePrefix: deps.challengePrefix,
      }),
    };
  }

  async function audit(action: string, organizationId: string, id: string, actor: CustomDomainActor): Promise<void> {
    await auditLogs?.log({
      organizationId,
      actorId: actor.userId,
      actorType: actor.actorType,
      action,
      resourceType: "statusPage",
      resourceId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const where: Prisma.CustomDomainWhereInput = { organizationId, deletedAt: null };
      const rows = (await prisma.customDomain.findMany({
        where: cursor ? { AND: [where, afterCursorDesc(cursor)] } : where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: SELECT,
      })) as Row[];
      const page = buildPage(rows, query.limit);
      return { items: page.items.map(toSummary), nextCursor: page.nextCursor };
    },

    async get(organizationId, id) {
      const row = (await prisma.customDomain.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: SELECT,
      })) as Row | null;
      return row ? toSummary(row) : null;
    },

    async resolve(host) {
      const domain = normalizeDomain(host);
      if (!domain) return null;
      const row = await prisma.customDomain.findFirst({
        where: { domain, verificationStatus: "VERIFIED", deletedAt: null },
        select: { organizationId: true, statusPageId: true, domain: true },
      });
      return row
        ? { organizationId: row.organizationId, statusPageId: row.statusPageId, domain: row.domain }
        : null;
    },

    async create(organizationId, input, actor) {
      await deps.assertCanUseCustomDomains?.(organizationId);

      const domain = normalizeDomain(input.domain);
      if (!domain) {
        throw new AppError("validation_failed", "Enter a valid domain, e.g. status.acme.com.");
      }

      // The status page must belong to this org (tenant isolation).
      const page = await prisma.statusPage.findFirst({
        where: { id: input.statusPageId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!page) throw AppError.notFound("Status page not found.");

      const verificationToken = randomBytes(24).toString("hex");
      try {
        const row = (await prisma.customDomain.create({
          data: {
            organizationId,
            statusPageId: input.statusPageId,
            domain,
            verificationToken,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
          select: SELECT,
        })) as Row;
        await audit("custom_domain.created", organizationId, row.id, actor);
        return toSummary(row);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw AppError.conflict("That domain is already connected to a status page.");
        }
        throw err;
      }
    },

    async verify(organizationId, id) {
      const row = (await prisma.customDomain.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: SELECT,
      })) as Row | null;
      if (!row) return null;

      const hostname = challengeHostname(row.domain, deps.challengePrefix);
      let status: "VERIFIED" | "FAILED" | "PENDING";
      let error: string | null = null;

      try {
        const records = await resolver.resolveTxt(hostname);
        const values = records.map((chunks) => chunks.join(""));
        if (values.includes(row.verificationToken)) {
          status = "VERIFIED";
        } else if (values.length > 0) {
          status = "FAILED";
          error = "A TXT record was found but did not match the expected verification token.";
        } else {
          status = "PENDING";
          error = "No verification TXT record found yet — DNS may still be propagating.";
        }
      } catch (err) {
        // NXDOMAIN / ENODATA / SERVFAIL etc. — treat as not-yet-propagated, not a 500.
        status = "PENDING";
        const code = (err as { code?: string }).code;
        error =
          code === "ENOTFOUND" || code === "ENODATA"
            ? "No verification TXT record found yet — DNS may still be propagating."
            : `DNS lookup failed${code ? ` (${code})` : ""} — will retry.`;
      }

      const now = new Date();
      const updated = (await prisma.customDomain.update({
        where: { id: row.id },
        data: {
          verificationStatus: status,
          lastCheckedAt: now,
          lastCheckError: status === "VERIFIED" ? null : error,
          verifiedAt: status === "VERIFIED" ? (row.verifiedAt ?? now) : row.verifiedAt,
        },
        select: SELECT,
      })) as Row;

      if (status === "VERIFIED" && row.verificationStatus !== "VERIFIED") {
        await audit("custom_domain.verified", organizationId, row.id, {
          userId: null,
          actorType: "user",
        });
      }
      return toSummary(updated);
    },

    async remove(organizationId, id, actor) {
      const existing = await prisma.customDomain.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return false;
      await prisma.customDomain.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId },
        select: { id: true },
      });
      await audit("custom_domain.deleted", organizationId, id, actor);
      return true;
    },
  };
}
