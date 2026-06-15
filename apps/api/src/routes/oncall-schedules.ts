import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  Actor,
  OnCallScheduleService,
  OverrideInput,
  UpsertScheduleInput,
} from "../services/oncall.service.js";

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  timezone: z.string().trim().min(1).max(64),
  rotationType: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "CUSTOM"]),
  handoffMinute: z.number().int().min(0).max(1439),
  participants: z.array(z.string().max(64)).min(1).max(50),
});

const overrideSchema = z.object({
  userId: z.string().max(64),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().max(500).optional(),
});

const onCallQuerySchema = z.object({ at: z.coerce.date().optional() });

export interface OnCallSchedulesRouterDeps {
  prisma: PrismaClient;
  onCallSchedules: OnCallScheduleService;
}

function actorOf(req: Request): Actor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
  };
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) throw AppError.notFound("On-call schedule not found.");
  return value;
}

/**
 * On-call schedule CRUD + overrides + "who is on call" under
 * /v1/organizations/:organizationId/oncall-schedules, gated by the
 * `onCallSchedule` RBAC resource. Overrides count as schedule updates.
 */
export function onCallSchedulesRouter(deps: OnCallSchedulesRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  const orgId = (req: Request): string => req.orgContext!.organizationId;

  router.get(
    "/",
    requirePermission("onCallSchedule", "read"),
    validate({ query: paginationQuerySchema }),
    async (req, res) => {
      const query = getValidated<{ limit: number; cursor?: string }>(req, "query");
      res.json(await deps.onCallSchedules.list(orgId(req), query));
    },
  );

  router.post(
    "/",
    requirePermission("onCallSchedule", "create"),
    validate({ body: upsertSchema }),
    async (req, res) => {
      const body = getValidated<UpsertScheduleInput>(req, "body");
      res.status(201).json(await deps.onCallSchedules.create(orgId(req), body, actorOf(req)));
    },
  );

  router.get("/:scheduleId", requirePermission("onCallSchedule", "read"), async (req, res) => {
    const detail = await deps.onCallSchedules.get(orgId(req), param(req, "scheduleId"));
    if (!detail) throw AppError.notFound("On-call schedule not found.");
    res.json(detail);
  });

  router.put(
    "/:scheduleId",
    requirePermission("onCallSchedule", "update"),
    validate({ body: upsertSchema }),
    async (req, res) => {
      const body = getValidated<UpsertScheduleInput>(req, "body");
      const updated = await deps.onCallSchedules.update(orgId(req), param(req, "scheduleId"), body, actorOf(req));
      if (!updated) throw AppError.notFound("On-call schedule not found.");
      res.json(updated);
    },
  );

  router.delete("/:scheduleId", requirePermission("onCallSchedule", "delete"), async (req, res) => {
    const ok = await deps.onCallSchedules.remove(orgId(req), param(req, "scheduleId"), actorOf(req));
    if (!ok) throw AppError.notFound("On-call schedule not found.");
    res.status(204).end();
  });

  router.get(
    "/:scheduleId/on-call",
    requirePermission("onCallSchedule", "read"),
    validate({ query: onCallQuerySchema }),
    async (req, res) => {
      const { at } = getValidated<{ at?: Date }>(req, "query");
      const view = await deps.onCallSchedules.whoIsOnCall(orgId(req), param(req, "scheduleId"), at);
      if (!view) throw AppError.notFound("On-call schedule not found.");
      res.json(view);
    },
  );

  router.get("/:scheduleId/overrides", requirePermission("onCallSchedule", "read"), async (req, res) => {
    const overrides = await deps.onCallSchedules.listOverrides(orgId(req), param(req, "scheduleId"));
    if (!overrides) throw AppError.notFound("On-call schedule not found.");
    res.json({ items: overrides });
  });

  router.post(
    "/:scheduleId/overrides",
    requirePermission("onCallSchedule", "update"),
    validate({ body: overrideSchema }),
    async (req, res) => {
      const body = getValidated<OverrideInput>(req, "body");
      const override = await deps.onCallSchedules.addOverride(orgId(req), param(req, "scheduleId"), body, actorOf(req));
      if (!override) throw AppError.notFound("On-call schedule not found.");
      res.status(201).json(override);
    },
  );

  router.delete(
    "/:scheduleId/overrides/:overrideId",
    requirePermission("onCallSchedule", "update"),
    async (req, res) => {
      const ok = await deps.onCallSchedules.removeOverride(
        orgId(req),
        param(req, "scheduleId"),
        param(req, "overrideId"),
        actorOf(req),
      );
      if (!ok) throw AppError.notFound("Override not found.");
      res.status(204).end();
    },
  );

  return router;
}
