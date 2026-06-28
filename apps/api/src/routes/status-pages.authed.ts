import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  StatusActor,
  StatusPageListQuery,
  StatusPageService,
} from "../services/status-page.service.js";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with single hyphens.");

const componentSchema = z.object({
  monitorId: z.string().uuid().nullish(),
  displayName: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  groupName: z.string().trim().max(120).nullish(),
  sortOrder: z.number().int().min(0).optional(),
});

const visibilitySchema = z.enum(["PUBLIC", "UNLISTED", "PRIVATE"]);

// Optional hex (#fff / #ffffff) so the public renderer can trust the value as a
// CSS color without sanitizing arbitrary strings.
const hexColor = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex color like #2fd180.");

const brandingSchema = z.object({
  logoUrl: z.string().trim().url().max(2048).nullish(),
  faviconUrl: z.string().trim().url().max(2048).nullish(),
  accent: hexColor.nullish(),
  footerText: z.string().trim().max(500).nullish(),
  timezone: z.string().trim().max(64).nullish(),
  socialLinks: z
    .array(z.object({ label: z.string().trim().min(1).max(40), url: z.string().trim().url().max(2048) }))
    .max(10)
    .optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  description: z.string().trim().max(1000).nullish(),
  customDomain: z.string().trim().max(253).nullish(),
  visibility: visibilitySchema.optional(),
  isPublic: z.boolean().optional(),
  branding: brandingSchema.nullish(),
  components: z.array(componentSchema).max(100).optional(),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    description: z.string().trim().max(1000).nullish(),
    customDomain: z.string().trim().max(253).nullish(),
    visibility: visibilitySchema,
    isPublic: z.boolean(),
    branding: brandingSchema.nullish(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

const componentStatusEnum = z.enum([
  "OPERATIONAL",
  "DEGRADED_PERFORMANCE",
  "PARTIAL_OUTAGE",
  "MAJOR_OUTAGE",
  "UNDER_MAINTENANCE",
]);

const componentCreateSchema = z.object({
  monitorId: z.string().uuid().nullish(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  groupName: z.string().trim().max(120).nullish(),
  status: componentStatusEnum.optional(),
  showUptime: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
});

const componentUpdateSchema = componentCreateSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

const reorderSchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});

const incidentImpact = z.enum(["NONE", "MINOR", "MAJOR", "CRITICAL", "MAINTENANCE"]);
const incidentStatus = z.enum(["INVESTIGATING", "IDENTIFIED", "MONITORING", "RESOLVED"]);

const openIncidentSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
  impact: incidentImpact.optional(),
});

const incidentUpdateSchema = z.object({
  status: incidentStatus,
  body: z.string().trim().min(1).max(5000),
});

export interface StatusPagesAuthedRouterDeps {
  prisma: PrismaClient;
  statusPages: StatusPageService;
}

function actorOf(req: Request): StatusActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function pageIdOf(req: Request): string {
  const id = req.params.id;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Status page not found.");
  return id;
}

function componentIdOf(req: Request): string {
  const id = req.params.componentId;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Component not found.");
  return id;
}

/**
 * Authenticated status-page management under
 * /v1/organizations/:organizationId/status-pages. Gated by the `statusPage`
 * RBAC resource; orgContext enforces tenant isolation (404 across orgs). Mirrors
 * the org-scoped path convention used by every other control-plane resource
 * (the literal /v1/status-pages from the spec would bypass that machinery).
 */
export function statusPagesAuthedRouter(deps: StatusPagesAuthedRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get(
    "/",
    requirePermission("statusPage", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<StatusPageListQuery>(req, "query");
      res.json(await deps.statusPages.list(req.orgContext!.organizationId, query));
    },
  );

  router.post(
    "/",
    requirePermission("statusPage", "create"),
    validate({ body: createSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof createSchema>>(req, "body");
      try {
        const page = await deps.statusPages.create(req.orgContext!.organizationId, input, actorOf(req));
        res.status(201).json(page);
      } catch (err) {
        throw mapWriteError(err);
      }
    },
  );

  router.get("/:id", requirePermission("statusPage", "read"), async (req, res) => {
    const page = await deps.statusPages.get(req.orgContext!.organizationId, pageIdOf(req));
    if (!page) throw AppError.notFound("Status page not found.");
    res.json(page);
  });

  router.patch(
    "/:id",
    requirePermission("statusPage", "update"),
    validate({ body: updateSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof updateSchema>>(req, "body");
      try {
        const page = await deps.statusPages.update(
          req.orgContext!.organizationId,
          pageIdOf(req),
          input,
          actorOf(req),
        );
        if (!page) throw AppError.notFound("Status page not found.");
        res.json(page);
      } catch (err) {
        throw mapWriteError(err);
      }
    },
  );

  router.delete("/:id", requirePermission("statusPage", "delete"), async (req, res) => {
    const ok = await deps.statusPages.remove(req.orgContext!.organizationId, pageIdOf(req), actorOf(req));
    if (!ok) throw AppError.notFound("Status page not found.");
    res.status(204).end();
  });

  // ── Components ─────────────────────────────────────────────────────────────
  router.get("/:id/components", requirePermission("statusPage", "read"), async (req, res) => {
    const rows = await deps.statusPages.listComponents(req.orgContext!.organizationId, pageIdOf(req));
    if (!rows) throw AppError.notFound("Status page not found.");
    res.json({ items: rows });
  });

  router.post(
    "/:id/components",
    requirePermission("statusPage", "update"),
    validate({ body: componentCreateSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof componentCreateSchema>>(req, "body");
      try {
        const row = await deps.statusPages.createComponent(
          req.orgContext!.organizationId,
          pageIdOf(req),
          input,
          actorOf(req),
        );
        if (!row) throw AppError.notFound("Status page not found.");
        res.status(201).json(row);
      } catch (err) {
        throw mapWriteError(err);
      }
    },
  );

  // Bulk reorder must precede the parameterized :componentId routes.
  router.post(
    "/:id/components/reorder",
    requirePermission("statusPage", "update"),
    validate({ body: reorderSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof reorderSchema>>(req, "body");
      const rows = await deps.statusPages.reorderComponents(
        req.orgContext!.organizationId,
        pageIdOf(req),
        input.orderedIds,
        actorOf(req),
      );
      if (!rows) throw AppError.notFound("Status page not found.");
      res.json({ items: rows });
    },
  );

  router.patch(
    "/:id/components/:componentId",
    requirePermission("statusPage", "update"),
    validate({ body: componentUpdateSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof componentUpdateSchema>>(req, "body");
      try {
        const row = await deps.statusPages.updateComponent(
          req.orgContext!.organizationId,
          pageIdOf(req),
          componentIdOf(req),
          input,
          actorOf(req),
        );
        if (!row) throw AppError.notFound("Component not found.");
        res.json(row);
      } catch (err) {
        throw mapWriteError(err);
      }
    },
  );

  router.delete(
    "/:id/components/:componentId",
    requirePermission("statusPage", "update"),
    async (req, res) => {
      const ok = await deps.statusPages.deleteComponent(
        req.orgContext!.organizationId,
        pageIdOf(req),
        componentIdOf(req),
        actorOf(req),
      );
      if (!ok) throw AppError.notFound("Component not found.");
      res.status(204).end();
    },
  );

  // ── Subscribers (read-only management view) ────────────────────────────────
  router.get(
    "/:id/subscribers",
    requirePermission("statusPage", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<StatusPageListQuery>(req, "query");
      const result = await deps.statusPages.listSubscribers(
        req.orgContext!.organizationId,
        pageIdOf(req),
        query,
      );
      if (!result) throw AppError.notFound("Status page not found.");
      res.json(result);
    },
  );

  // ── Incidents (authed list for the dashboard) ──────────────────────────────
  router.get(
    "/:id/incidents",
    requirePermission("statusPage", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<StatusPageListQuery>(req, "query");
      const result = await deps.statusPages.listIncidents(
        req.orgContext!.organizationId,
        pageIdOf(req),
        query,
      );
      if (!result) throw AppError.notFound("Status page not found.");
      res.json(result);
    },
  );

  router.post(
    "/:id/incidents",
    requirePermission("statusPage", "update"),
    validate({ body: openIncidentSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof openIncidentSchema>>(req, "body");
      const incident = await deps.statusPages.openIncident(
        req.orgContext!.organizationId,
        pageIdOf(req),
        input,
        actorOf(req),
      );
      if (!incident) throw AppError.notFound("Status page not found.");
      res.status(201).json(incident);
    },
  );

  router.post(
    "/:id/incidents/:incidentId/updates",
    requirePermission("statusPage", "update"),
    validate({ body: incidentUpdateSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof incidentUpdateSchema>>(req, "body");
      const incidentId = req.params.incidentId;
      if (typeof incidentId !== "string" || incidentId.length === 0) {
        throw AppError.notFound("Incident not found.");
      }
      const incident = await deps.statusPages.addIncidentUpdate(
        req.orgContext!.organizationId,
        pageIdOf(req),
        incidentId,
        input,
        actorOf(req),
      );
      if (!incident) throw AppError.notFound("Incident not found.");
      res.status(201).json(incident);
    },
  );

  return router;
}

/** Translate Prisma unique-constraint violations (slug/customDomain) to 409s. */
function mapWriteError(err: unknown): unknown {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
    return AppError.conflict("A status page with that slug or custom domain already exists.");
  }
  return err;
}
