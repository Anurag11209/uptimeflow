import { buildPage, type Page } from "@backend-uptime/shared";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

export interface IntegrationActor {
  userId: string | null;
  actorType: "user" | "api_key";
  ipAddress?: string | null;
  userAgent?: string | null;
}

type Row = Record<string, unknown> & { id: string; createdAt: Date };

/**
 * Structural slice of a Prisma model delegate (slackIntegration, etc.). The
 * concrete delegates are passed in cast to this shape so one service body
 * drives CRUD for every provider table.
 */
export interface IntegrationDelegate {
  findMany(args: unknown): Promise<Row[]>;
  findFirst(args: unknown): Promise<Row | null>;
  create(args: unknown): Promise<Row>;
  update(args: unknown): Promise<Row>;
}

export interface IntegrationListQuery {
  limit: number;
  cursor?: string;
}

export interface IntegrationServiceConfig<TSummary, TCreate, TUpdate> {
  auditLogs?: AuditLogService;
  delegate: IntegrationDelegate;
  /** Prisma select for read queries (must include id + createdAt for paging). */
  select: Record<string, true>;
  /** Audit + RBAC resource label, e.g. "slack_integration". */
  resourceLabel: string;
  toSummary: (row: Row) => TSummary;
  createData: (input: TCreate, ctx: { organizationId: string; actor: IntegrationActor }) => Record<string, unknown>;
  updateData: (input: TUpdate, actor: IntegrationActor) => Record<string, unknown>;
}

export interface IntegrationService<TSummary, TCreate, TUpdate> {
  list(organizationId: string, query: IntegrationListQuery): Promise<Page<TSummary>>;
  get(organizationId: string, id: string): Promise<TSummary | null>;
  create(organizationId: string, input: TCreate, actor: IntegrationActor): Promise<TSummary>;
  update(organizationId: string, id: string, input: TUpdate, actor: IntegrationActor): Promise<TSummary | null>;
  remove(organizationId: string, id: string, actor: IntegrationActor): Promise<boolean>;
  /** Bare existence check (org-scoped, not soft-deleted) for the test endpoint. */
  exists(organizationId: string, id: string): Promise<boolean>;
}

/**
 * Generic CRUD for an outbound integration provider table. Tenant-scoped on
 * every query (organizationId in the where-clause), soft-deleting, with one
 * audit entry per mutation. Reused by the Slack/Discord/Webhook routers.
 */
export function createIntegrationService<TSummary, TCreate, TUpdate>(
  prismaAudit: { auditLogs?: AuditLogService },
  config: IntegrationServiceConfig<TSummary, TCreate, TUpdate>,
): IntegrationService<TSummary, TCreate, TUpdate> {
  const { delegate, select, resourceLabel, toSummary } = config;
  const auditLogs = config.auditLogs ?? prismaAudit.auditLogs;

  async function audit(action: string, organizationId: string, id: string, actor: IntegrationActor): Promise<void> {
    await auditLogs?.log({
      organizationId,
      actorId: actor.userId,
      actorType: actor.actorType,
      action: `${resourceLabel}.${action}`,
      resourceType: "alertChannel",
      resourceId: id,
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    });
  }

  return {
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const where: Record<string, unknown> = { organizationId, deletedAt: null };
      const rows = await delegate.findMany({
        where: cursor ? { AND: [where, afterCursorDesc(cursor)] } : where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select,
      });
      return buildPageSummaries(rows, query.limit, toSummary);
    },

    async get(organizationId, id) {
      const row = await delegate.findFirst({ where: { id, organizationId, deletedAt: null }, select });
      return row ? toSummary(row) : null;
    },

    async create(organizationId, input, actor) {
      const row = await delegate.create({ data: config.createData(input, { organizationId, actor }), select });
      await audit("created", organizationId, row.id, actor);
      return toSummary(row);
    },

    async update(organizationId, id, input, actor) {
      const existing = await delegate.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } });
      if (!existing) return null;
      const row = await delegate.update({ where: { id }, data: config.updateData(input, actor), select });
      await audit("updated", organizationId, id, actor);
      return toSummary(row);
    },

    async remove(organizationId, id, actor) {
      const existing = await delegate.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } });
      if (!existing) return false;
      await delegate.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId },
        select: { id: true },
      });
      await audit("deleted", organizationId, id, actor);
      return true;
    },

    async exists(organizationId, id) {
      const row = await delegate.findFirst({ where: { id, organizationId, deletedAt: null }, select: { id: true } });
      return row !== null;
    },
  };
}

/** buildPage wants `{id, createdAt}`; map rows to summaries while keeping the cursor keys. */
function buildPageSummaries<TSummary>(
  rows: Row[],
  limit: number,
  toSummary: (row: Row) => TSummary,
): Page<TSummary> {
  const page = buildPage(
    rows.map((r) => ({ id: r.id, createdAt: r.createdAt, summary: toSummary(r) })),
    limit,
  );
  return { items: page.items.map((p) => p.summary), nextCursor: page.nextCursor };
}
