import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  CreateMonitorInput,
  MonitorActor,
  MonitorListQuery,
  MonitorService,
  UpdateMonitorInput,
} from "../services/monitor.service.js";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const assertionSchema = z.object({
  source: z.enum([
    "STATUS_CODE",
    "RESPONSE_TIME",
    "HEADER",
    "BODY_TEXT",
    "BODY_JSON",
    "SSL_EXPIRY_DAYS",
    "DNS_RECORD",
  ]),
  comparator: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "CONTAINS",
    "NOT_CONTAINS",
    "GREATER_THAN",
    "LESS_THAN",
    "MATCHES_REGEX",
    "EXISTS",
  ]),
  property: z.string().max(200).optional(),
  expected: z.string().max(2000),
});

const PROBE_REGIONS = [
  "NA_EAST",
  "NA_WEST",
  "EU_WEST",
  "EU_CENTRAL",
  "AP_SOUTHEAST",
  "AP_NORTHEAST",
  "SA_EAST",
  "AF_SOUTH",
] as const;

/** DNS and GRPC are schema-declared but have no probe implementation yet. */
const SUPPORTED_TYPES = ["HTTP", "KEYWORD", "SSL", "TCP", "PORT", "PING", "HEARTBEAT"] as const;

const createMonitorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(SUPPORTED_TYPES),
  groupId: z.string().uuid().optional(),
  // Target
  url: z.string().url().max(2048).optional(),
  host: z.string().max(253).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  httpMethod: z.enum(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]).optional(),
  requestHeaders: z.record(z.string().max(1000)).optional(),
  requestBody: z.string().max(10_000).optional(),
  expectedStatus: z.number().int().min(100).max(599).optional(),
  keyword: z.string().max(1000).optional(),
  keywordInverted: z.boolean().optional(),
  followRedirects: z.boolean().optional(),
  verifySsl: z.boolean().optional(),
  // Scheduling
  intervalSeconds: z.number().int().min(30).max(86_400).optional(),
  timeoutSeconds: z.number().int().min(1).max(60).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  regions: z.array(z.enum(PROBE_REGIONS)).optional(),
  // Thresholds
  failureThreshold: z.number().int().min(1).max(10).optional(),
  successThreshold: z.number().int().min(1).max(10).optional(),
  // Routing
  escalationPolicyId: z.string().uuid().optional(),
  // Nested
  assertions: z.array(assertionSchema).max(20).optional(),
  channelIds: z.array(z.string().uuid()).max(50).optional(),
});

const updateMonitorSchema = createMonitorSchema.partial();

const listQuerySchema = paginationQuerySchema.extend({
  groupId: z.string().uuid().optional(),
  health: z
    .enum(["UP", "DOWN", "DEGRADED", "PENDING", "PAUSED", "MAINTENANCE", "RECOVERING"])
    .optional(),
  state: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
});

const checkResultQuerySchema = paginationQuerySchema.extend({
  region: z.enum(PROBE_REGIONS).optional(),
});

const setChannelsSchema = z.object({
  channelIds: z.array(z.string().uuid()).max(50),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function actorOf(req: Request): MonitorActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
  };
}

function monitorIdOf(req: Request): string {
  const id = req.params.monitorId;
  if (typeof id !== "string" || id.length === 0) throw AppError.notFound("Monitor not found.");
  return id;
}

/** Map service-level error codes to HTTP responses. */
function handleServiceError(error: unknown, res: import("express").Response): boolean {
  if (!(error instanceof Error)) return false;
  const map: Record<string, [number, string]> = {
    URL_REQUIRED: [422, "A URL is required for this monitor type."],
    HOST_REQUIRED: [422, "A host is required for this monitor type."],
    PORT_REQUIRED: [422, "A port is required for this monitor type."],
    UNSUPPORTED_TYPE: [422, "DNS and GRPC monitor types are not yet supported."],
    INVALID_GROUP: [422, "Group not found or does not belong to this organization."],
    INVALID_ESCALATION_POLICY: [
      422,
      "Escalation policy not found or does not belong to this organization.",
    ],
    INVALID_CHANNEL: [422, "One or more channel IDs do not belong to this organization."],
  };
  const entry = map[error.message];
  if (!entry) return false;
  res.status(entry[0]).json({ error: entry[1] });
  return true;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export interface MonitorsRouterDeps {
  prisma: PrismaClient;
  monitors: MonitorService;
}

/**
 * Monitor CRUD + sub-resources under
 * /v1/organizations/:organizationId/monitors, gated by the `monitor` RBAC
 * resource. orgContext enforces tenant isolation.
 */
export function monitorsRouter(deps: MonitorsRouterDeps): Router {
  const router = Router({ mergeParams: true });

  router.use(orgContext(deps.prisma));

  // ── List ────────────────────────────────────────────────────────────────────

  router.get(
    "/",
    requirePermission("monitor", "read"),
    validate({ query: listQuerySchema }),
    async (req, res, next) => {
      try {
        const query = getValidated<MonitorListQuery>(req, "query");
        const page = await deps.monitors.list(req.orgContext!.organizationId, query);
        res.json(page);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Create ──────────────────────────────────────────────────────────────────

  router.post(
    "/",
    requirePermission("monitor", "create"),
    validate({ body: createMonitorSchema }),
    async (req, res, next) => {
      try {
        const input = getValidated<CreateMonitorInput>(req, "body");
        const monitor = await deps.monitors.create(
          req.orgContext!.organizationId,
          input,
          actorOf(req),
        );
        res.status(201).json(monitor);
      } catch (err) {
        if (handleServiceError(err, res)) return;
        next(err);
      }
    },
  );

  // ── Get ─────────────────────────────────────────────────────────────────────

  router.get("/:monitorId", requirePermission("monitor", "read"), async (req, res, next) => {
    try {
      const detail = await deps.monitors.get(req.orgContext!.organizationId, monitorIdOf(req));
      if (!detail) throw AppError.notFound("Monitor not found.");
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // ── Update ──────────────────────────────────────────────────────────────────

  router.patch(
    "/:monitorId",
    requirePermission("monitor", "update"),
    validate({ body: updateMonitorSchema }),
    async (req, res, next) => {
      try {
        const input = getValidated<UpdateMonitorInput>(req, "body");
        const detail = await deps.monitors.update(
          req.orgContext!.organizationId,
          monitorIdOf(req),
          input,
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Monitor not found.");
        res.json(detail);
      } catch (err) {
        if (handleServiceError(err, res)) return;
        next(err);
      }
    },
  );

  // ── Delete ──────────────────────────────────────────────────────────────────

  router.delete("/:monitorId", requirePermission("monitor", "delete"), async (req, res, next) => {
    try {
      const deleted = await deps.monitors.remove(
        req.orgContext!.organizationId,
        monitorIdOf(req),
        actorOf(req),
      );
      if (!deleted) throw AppError.notFound("Monitor not found.");
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // ── Pause / Resume ──────────────────────────────────────────────────────────

  router.post(
    "/:monitorId/pause",
    requirePermission("monitor", "update"),
    async (req, res, next) => {
      try {
        const detail = await deps.monitors.pause(
          req.orgContext!.organizationId,
          monitorIdOf(req),
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Monitor not found.");
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/:monitorId/resume",
    requirePermission("monitor", "update"),
    async (req, res, next) => {
      try {
        const detail = await deps.monitors.resume(
          req.orgContext!.organizationId,
          monitorIdOf(req),
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Monitor not found.");
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Check Results ───────────────────────────────────────────────────────────

  router.get(
    "/:monitorId/check-results",
    requirePermission("monitor", "read"),
    validate({ query: checkResultQuerySchema }),
    async (req, res, next) => {
      try {
        const query = getValidated<{ limit: number; cursor?: string; region?: string }>(
          req,
          "query",
        );
        const page = await deps.monitors.listCheckResults(
          req.orgContext!.organizationId,
          monitorIdOf(req),
          query as Parameters<MonitorService["listCheckResults"]>[2],
        );
        if (!page) throw AppError.notFound("Monitor not found.");
        res.json(page);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Channel Bindings ────────────────────────────────────────────────────────

  router.get(
    "/:monitorId/channels",
    requirePermission("monitor", "read"),
    async (req, res, next) => {
      try {
        const detail = await deps.monitors.get(req.orgContext!.organizationId, monitorIdOf(req));
        if (!detail) throw AppError.notFound("Monitor not found.");
        res.json({ channelIds: detail.boundChannelIds });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    "/:monitorId/channels",
    requirePermission("monitor", "update"),
    validate({ body: setChannelsSchema }),
    async (req, res, next) => {
      try {
        const { channelIds } = getValidated<{ channelIds: string[] }>(req, "body");
        const bound = await deps.monitors.setChannels(
          req.orgContext!.organizationId,
          monitorIdOf(req),
          channelIds,
        );
        if (!bound) throw AppError.notFound("Monitor not found.");
        res.json({ channelIds: bound });
      } catch (err) {
        if (handleServiceError(err, res)) return;
        next(err);
      }
    },
  );

  // ── Maintenance Windows ─────────────────────────────────────────────────────

  router.get(
    "/:monitorId/maintenance-windows",
    requirePermission("monitor", "read"),
    async (req, res, next) => {
      try {
        const windows = await deps.monitors.listMaintenanceWindows(
          req.orgContext!.organizationId,
          monitorIdOf(req),
        );
        res.json(windows);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
