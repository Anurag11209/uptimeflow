import { randomBytes } from "node:crypto";
import type {
  ComponentStatus,
  MonitorHealth,
  Prisma,
  PrismaClient,
  StatusPageIncidentImpact,
  StatusPageIncidentStatus,
} from "@backend-uptime/db";
import { buildPage, type Page } from "@backend-uptime/shared";
import { afterCursorDesc, parseCursor } from "./cursor.js";
import type { AuditLogService } from "./audit-log.service.js";

// ───────────────────────────── Public view types ────────────────────────────

export interface PublicStatusComponent {
  id: string;
  name: string;
  description: string | null;
  groupName: string | null;
  status: ComponentStatus;
  showUptime: boolean;
}

export interface PublicStatusIncidentUpdate {
  status: StatusPageIncidentStatus;
  body: string;
  createdAt: Date;
}

export interface PublicStatusIncident {
  id: string;
  title: string;
  status: StatusPageIncidentStatus;
  impact: StatusPageIncidentImpact;
  startedAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updates: PublicStatusIncidentUpdate[];
}

export interface PublicStatusPage {
  name: string;
  slug: string;
  description: string | null;
  branding: unknown;
  /** Worst component status across the page; OPERATIONAL when all clear. */
  overallStatus: ComponentStatus;
  components: PublicStatusComponent[];
  activeIncidents: PublicStatusIncident[];
  updatedAt: Date;
}

export interface StatusHistoryDay {
  day: string;
  uptimePct: number | null;
}

export interface StatusHistoryComponent {
  id: string;
  name: string;
  uptimePct: number | null;
  days: StatusHistoryDay[];
}

export interface StatusHistory {
  windowDays: number;
  overallUptimePct: number | null;
  components: StatusHistoryComponent[];
}

// ───────────────────────────── Authed view types ────────────────────────────

export interface StatusPageSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  customDomain: string | null;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface StatusPageComponentInput {
  monitorId?: string | null;
  displayName: string;
  description?: string | null;
  groupName?: string | null;
  sortOrder?: number;
}

export interface StatusPageCreateInput {
  name: string;
  slug: string;
  description?: string | null;
  customDomain?: string | null;
  isPublic?: boolean;
  components?: StatusPageComponentInput[];
}

export type StatusPageUpdateInput = Partial<Omit<StatusPageCreateInput, "components">>;

export interface StatusPageListQuery {
  limit: number;
  cursor?: string;
}

export interface SubscribeResult {
  status: "pending" | "already_active";
  /** Present only when a verification email should be sent. */
  verificationToken: string | null;
  email: string;
}

export interface IncidentOpenInput {
  title: string;
  body: string;
  impact?: StatusPageIncidentImpact;
}

export interface IncidentUpdateInput {
  status: StatusPageIncidentStatus;
  body: string;
}

export interface StatusActor {
  userId: string | null;
  actorType: "user" | "api_key";
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Side-channel for subscriber emails, injected so the service stays free of
 * BullMQ/transport details (the concrete impl wraps the email queue). All
 * methods are best-effort: a notification failure must never fail the request.
 */
export interface StatusNotifier {
  sendVerification(input: { pageName: string; email: string; confirmUrl: string }): Promise<void>;
  notifyIncident(input: {
    statusPageId: string;
    pageSlug: string;
    pageName: string;
    incidentId: string;
    updateId: string;
    title: string;
    phase: "opened" | "updated" | "resolved";
    statusLabel: string;
    body: string;
  }): Promise<void>;
}

export interface StatusPageService {
  // Authed CRUD (org-scoped).
  list(organizationId: string, query: StatusPageListQuery): Promise<Page<StatusPageSummary>>;
  get(organizationId: string, id: string): Promise<StatusPageSummary | null>;
  create(organizationId: string, input: StatusPageCreateInput, actor: StatusActor): Promise<StatusPageSummary>;
  update(
    organizationId: string,
    id: string,
    input: StatusPageUpdateInput,
    actor: StatusActor,
  ): Promise<StatusPageSummary | null>;
  remove(organizationId: string, id: string, actor: StatusActor): Promise<boolean>;
  // Authed incident lifecycle (drives subscriber notifications, Phase 7D).
  openIncident(
    organizationId: string,
    pageId: string,
    input: IncidentOpenInput,
    actor: StatusActor,
  ): Promise<PublicStatusIncident | null>;
  addIncidentUpdate(
    organizationId: string,
    pageId: string,
    incidentId: string,
    input: IncidentUpdateInput,
    actor: StatusActor,
  ): Promise<PublicStatusIncident | null>;
  // Public reads.
  getPublicPage(slug: string): Promise<PublicStatusPage | null>;
  listPublicIncidents(slug: string, query: StatusPageListQuery): Promise<Page<PublicStatusIncident> | null>;
  getHistory(slug: string, windowDays: number): Promise<StatusHistory | null>;
  // Public subscriber flows.
  subscribe(slug: string, email: string): Promise<SubscribeResult | null>;
  verifySubscriber(slug: string, token: string): Promise<boolean>;
  unsubscribe(slug: string, token: string): Promise<boolean>;
}

// ───────────────────────────── Status mapping ───────────────────────────────

const STATUS_SEVERITY: Record<ComponentStatus, number> = {
  OPERATIONAL: 0,
  UNDER_MAINTENANCE: 1,
  DEGRADED_PERFORMANCE: 2,
  PARTIAL_OUTAGE: 3,
  MAJOR_OUTAGE: 4,
};

const HEALTH_TO_STATUS: Partial<Record<MonitorHealth, ComponentStatus>> = {
  UP: "OPERATIONAL",
  DOWN: "MAJOR_OUTAGE",
  DEGRADED: "DEGRADED_PERFORMANCE",
  RECOVERING: "DEGRADED_PERFORMANCE",
  MAINTENANCE: "UNDER_MAINTENANCE",
};

const PAGE_SELECT = {
  name: true,
  slug: true,
  description: true,
  branding: true,
  updatedAt: true,
  components: {
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      groupName: true,
      status: true,
      showUptime: true,
      monitor: { select: { health: true } },
    },
  },
  incidents: {
    where: { resolvedAt: null },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      impact: true,
      startedAt: true,
      resolvedAt: true,
      createdAt: true,
      updates: {
        orderBy: { createdAt: "desc" },
        select: { status: true, body: true, createdAt: true },
      },
    },
  },
} satisfies Prisma.StatusPageSelect;

type PageRow = Prisma.StatusPageGetPayload<{ select: typeof PAGE_SELECT }>;

const INCIDENT_SELECT = {
  id: true,
  title: true,
  status: true,
  impact: true,
  startedAt: true,
  resolvedAt: true,
  createdAt: true,
  updates: {
    orderBy: { createdAt: "desc" },
    select: { status: true, body: true, createdAt: true },
  },
} satisfies Prisma.StatusPageIncidentSelect;

type IncidentRow = Prisma.StatusPageIncidentGetPayload<{ select: typeof INCIDENT_SELECT }>;

const SUMMARY_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  customDomain: true,
  visibility: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StatusPageSelect;

type SummaryRow = Prisma.StatusPageGetPayload<{ select: typeof SUMMARY_SELECT }>;

function componentStatus(row: PageRow["components"][number]): ComponentStatus {
  const derived = row.monitor ? HEALTH_TO_STATUS[row.monitor.health] : undefined;
  return derived ?? row.status;
}

function toIncident(row: IncidentRow): PublicStatusIncident {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    impact: row.impact,
    startedAt: row.startedAt,
    resolvedAt: row.resolvedAt,
    createdAt: row.createdAt,
    updates: row.updates,
  };
}

function toSummary(row: SummaryRow): StatusPageSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    customDomain: row.customDomain,
    isPublic: row.visibility === "PUBLIC",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPublicPage(row: PageRow): PublicStatusPage {
  const components = row.components.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    groupName: c.groupName,
    status: componentStatus(c),
    showUptime: c.showUptime,
  }));

  const overallStatus = components.reduce<ComponentStatus>(
    (worst, c) => (STATUS_SEVERITY[c.status] > STATUS_SEVERITY[worst] ? c.status : worst),
    "OPERATIONAL",
  );

  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    branding: row.branding,
    overallStatus,
    components,
    activeIncidents: row.incidents.map(toIncident),
    updatedAt: row.updatedAt,
  };
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// ─────────────────────────────── Service ────────────────────────────────────

/**
 * Status pages: org-scoped CRUD for operators plus the public read + subscriber
 * surface. Tenant isolation on every authed query (organizationId in the
 * where-clause); public reads are addressed by globally-unique slug and exclude
 * PRIVATE/soft-deleted pages. Mutations append audit entries; subscriber and
 * incident flows hand off to the injected notifier for email.
 */
export function createStatusPageService(deps: {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
  notifier?: StatusNotifier;
  /** Public web origin used to build confirm/status links. */
  webUrl?: string;
}): StatusPageService {
  const { prisma, auditLogs, notifier } = deps;
  const webUrl = (deps.webUrl ?? "http://localhost:3000").replace(/\/$/, "");

  async function audit(event: Parameters<AuditLogService["log"]>[0]): Promise<void> {
    if (auditLogs) await auditLogs.log(event);
  }

  /** Resolve a public (non-private, non-deleted) page id by slug. */
  async function publicPageBySlug(
    slug: string,
  ): Promise<{ id: string; name: string; slug: string } | null> {
    return prisma.statusPage.findFirst({
      where: { slug, deletedAt: null, visibility: { in: ["PUBLIC", "UNLISTED"] } },
      select: { id: true, name: true, slug: true },
    });
  }

  return {
    // ── Authed CRUD ──────────────────────────────────────────────────────
    async list(organizationId, query) {
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.StatusPageWhereInput[] = [{ organizationId, deletedAt: null }];
      if (cursor) conditions.push(afterCursorDesc(cursor));
      const rows = await prisma.statusPage.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: SUMMARY_SELECT,
      });
      return buildPage(rows.map(toSummary), query.limit);
    },

    async get(organizationId, id) {
      const row = await prisma.statusPage.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: SUMMARY_SELECT,
      });
      return row ? toSummary(row) : null;
    },

    async create(organizationId, input, actor) {
      const row = await prisma.statusPage.create({
        data: {
          organizationId,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          customDomain: input.customDomain ?? null,
          visibility: input.isPublic === false ? "PRIVATE" : "PUBLIC",
          createdById: actor.userId,
          updatedById: actor.userId,
          components: input.components?.length
            ? {
                create: input.components.map((c, i) => ({
                  monitorId: c.monitorId ?? null,
                  name: c.displayName,
                  description: c.description ?? null,
                  groupName: c.groupName ?? null,
                  position: c.sortOrder ?? i,
                })),
              }
            : undefined,
        },
        select: SUMMARY_SELECT,
      });
      await audit({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "status_page.created",
        resourceType: "statusPage",
        resourceId: row.id,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return toSummary(row);
    },

    async update(organizationId, id, input, actor) {
      const existing = await prisma.statusPage.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return null;

      const data: Prisma.StatusPageUpdateInput = { updatedById: actor.userId };
      if (input.name !== undefined) data.name = input.name;
      if (input.slug !== undefined) data.slug = input.slug;
      if (input.description !== undefined) data.description = input.description;
      if (input.customDomain !== undefined) data.customDomain = input.customDomain;
      if (input.isPublic !== undefined) data.visibility = input.isPublic ? "PUBLIC" : "PRIVATE";

      const row = await prisma.statusPage.update({ where: { id }, data, select: SUMMARY_SELECT });
      await audit({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "status_page.updated",
        resourceType: "statusPage",
        resourceId: id,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return toSummary(row);
    },

    async remove(organizationId, id, actor) {
      const existing = await prisma.statusPage.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!existing) return false;
      await prisma.statusPage.update({
        where: { id },
        data: { deletedAt: new Date(), deletedById: actor.userId },
      });
      await audit({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "status_page.deleted",
        resourceType: "statusPage",
        resourceId: id,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });
      return true;
    },

    // ── Authed incident lifecycle ────────────────────────────────────────
    async openIncident(organizationId, pageId, input, actor) {
      const page = await prisma.statusPage.findFirst({
        where: { id: pageId, organizationId, deletedAt: null },
        select: { id: true, name: true, slug: true },
      });
      if (!page) return null;

      const incident = await prisma.statusPageIncident.create({
        data: {
          statusPageId: pageId,
          title: input.title,
          status: "INVESTIGATING",
          impact: input.impact ?? "MINOR",
          updates: { create: { status: "INVESTIGATING", body: input.body } },
        },
        select: INCIDENT_SELECT,
      });
      await audit({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "status_page.incident_opened",
        resourceType: "statusPage",
        resourceId: pageId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { incidentId: incident.id },
      });
      await notifier?.notifyIncident({
        statusPageId: page.id,
        pageSlug: page.slug,
        pageName: page.name,
        incidentId: incident.id,
        updateId: incident.updates[0]?.createdAt.toISOString() ?? incident.id,
        title: incident.title,
        phase: "opened",
        statusLabel: incident.status,
        body: input.body,
      });
      return toIncident(incident);
    },

    async addIncidentUpdate(organizationId, pageId, incidentId, input, actor) {
      const incident = await prisma.statusPageIncident.findFirst({
        where: { id: incidentId, statusPageId: pageId, statusPage: { organizationId, deletedAt: null } },
        select: { id: true, statusPage: { select: { id: true, name: true, slug: true } } },
      });
      if (!incident) return null;

      const resolved = input.status === "RESOLVED";
      const update = await prisma.statusPageIncidentUpdate.create({
        data: { incidentId, status: input.status, body: input.body },
        select: { id: true },
      });
      await prisma.statusPageIncident.update({
        where: { id: incidentId },
        data: { status: input.status, resolvedAt: resolved ? new Date() : null },
      });
      const fresh = await prisma.statusPageIncident.findUniqueOrThrow({
        where: { id: incidentId },
        select: INCIDENT_SELECT,
      });
      await audit({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: resolved ? "status_page.incident_resolved" : "status_page.incident_updated",
        resourceType: "statusPage",
        resourceId: pageId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
        metadata: { incidentId },
      });
      await notifier?.notifyIncident({
        statusPageId: incident.statusPage.id,
        pageSlug: incident.statusPage.slug,
        pageName: incident.statusPage.name,
        incidentId,
        updateId: update.id,
        title: fresh.title,
        phase: resolved ? "resolved" : "updated",
        statusLabel: input.status,
        body: input.body,
      });
      return toIncident(fresh);
    },

    // ── Public reads ─────────────────────────────────────────────────────
    async getPublicPage(slug) {
      const row = await prisma.statusPage.findFirst({
        where: { slug, deletedAt: null, visibility: { in: ["PUBLIC", "UNLISTED"] } },
        select: PAGE_SELECT,
      });
      return row ? toPublicPage(row) : null;
    },

    async listPublicIncidents(slug, query) {
      const page = await publicPageBySlug(slug);
      if (!page) return null;
      const cursor = parseCursor(query.cursor);
      const conditions: Prisma.StatusPageIncidentWhereInput[] = [{ statusPageId: page.id }];
      if (cursor) conditions.push(afterCursorDesc(cursor));
      const rows = await prisma.statusPageIncident.findMany({
        where: { AND: conditions },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
        select: INCIDENT_SELECT,
      });
      return buildPage(rows.map(toIncident), query.limit);
    },

    async getHistory(slug, windowDays) {
      const row = await prisma.statusPage.findFirst({
        where: { slug, deletedAt: null, visibility: { in: ["PUBLIC", "UNLISTED"] } },
        select: {
          components: {
            where: { showUptime: true, monitorId: { not: null } },
            orderBy: [{ position: "asc" }, { createdAt: "asc" }],
            select: { id: true, name: true, monitorId: true },
          },
        },
      });
      if (!row) return null;

      const since = new Date(Date.now() - windowDays * 86_400_000);
      const monitorIds = row.components.map((c) => c.monitorId).filter((m): m is string => Boolean(m));

      // Aggregate daily stats across all regions per (monitor, day).
      const stats = monitorIds.length
        ? await prisma.monitorDailyStat.findMany({
            where: { monitorId: { in: monitorIds }, day: { gte: since } },
            select: { monitorId: true, day: true, upChecks: true, totalChecks: true },
          })
        : [];

      const byMonitor = new Map<string, Map<string, { up: number; total: number }>>();
      for (const s of stats) {
        const days = byMonitor.get(s.monitorId) ?? new Map();
        const key = dayKey(s.day);
        const acc = days.get(key) ?? { up: 0, total: 0 };
        acc.up += s.upChecks;
        acc.total += s.totalChecks;
        days.set(key, acc);
        byMonitor.set(s.monitorId, days);
      }

      let overallUp = 0;
      let overallTotal = 0;
      const components: StatusHistoryComponent[] = row.components.map((c) => {
        const days = c.monitorId ? byMonitor.get(c.monitorId) : undefined;
        let up = 0;
        let total = 0;
        const series: StatusHistoryDay[] = [];
        for (let i = windowDays - 1; i >= 0; i--) {
          const d = dayKey(new Date(Date.now() - i * 86_400_000));
          const acc = days?.get(d);
          series.push({ day: d, uptimePct: acc && acc.total > 0 ? round2((acc.up / acc.total) * 100) : null });
          if (acc) {
            up += acc.up;
            total += acc.total;
          }
        }
        overallUp += up;
        overallTotal += total;
        return { id: c.id, name: c.name, uptimePct: total > 0 ? round2((up / total) * 100) : null, days: series };
      });

      return {
        windowDays,
        overallUptimePct: overallTotal > 0 ? round2((overallUp / overallTotal) * 100) : null,
        components,
      };
    },

    // ── Public subscriber flows ──────────────────────────────────────────
    async subscribe(slug, email) {
      const page = await publicPageBySlug(slug);
      if (!page) return null;
      const normalized = email.trim().toLowerCase();

      const existing = await prisma.statusPageSubscriber.findUnique({
        where: { statusPageId_email: { statusPageId: page.id, email: normalized } },
        select: { id: true, status: true },
      });

      if (existing?.status === "ACTIVE") {
        return { status: "already_active", verificationToken: null, email: normalized };
      }

      const verificationToken = token();
      const unsubscribeToken = token();
      await prisma.statusPageSubscriber.upsert({
        where: { statusPageId_email: { statusPageId: page.id, email: normalized } },
        create: {
          statusPageId: page.id,
          email: normalized,
          status: "PENDING",
          verificationToken,
          unsubscribeToken,
        },
        update: {
          status: "PENDING",
          verificationToken,
          unsubscribedAt: null,
        },
      });

      if (notifier) {
        await notifier.sendVerification({
          pageName: page.name,
          email: normalized,
          confirmUrl: `${webUrl}/status/${page.slug}/verify?token=${verificationToken}`,
        });
      }
      return { status: "pending", verificationToken, email: normalized };
    },

    async verifySubscriber(slug, verificationToken) {
      const sub = await prisma.statusPageSubscriber.findFirst({
        where: { verificationToken, statusPage: { slug, deletedAt: null } },
        select: { id: true, unsubscribeToken: true },
      });
      if (!sub) return false;
      await prisma.statusPageSubscriber.update({
        where: { id: sub.id },
        data: {
          status: "ACTIVE",
          verifiedAt: new Date(),
          verificationToken: null,
          unsubscribeToken: sub.unsubscribeToken ?? token(),
        },
      });
      return true;
    },

    async unsubscribe(slug, unsubscribeToken) {
      const sub = await prisma.statusPageSubscriber.findFirst({
        where: { unsubscribeToken, statusPage: { slug, deletedAt: null } },
        select: { id: true },
      });
      if (!sub) return false;
      await prisma.statusPageSubscriber.update({
        where: { id: sub.id },
        data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() },
      });
      return true;
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
