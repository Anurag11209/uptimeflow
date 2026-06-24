import { Router, type Request } from "express";
import { z } from "zod";
import { AppError, paginationQuerySchema } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type {
  AlertChannelActor,
  AlertChannelListQuery,
  AlertChannelService,
  CreateAlertChannelInput,
  UpdateAlertChannelInput,
} from "../services/alert-channel.service.js";

const SUPPORTED_CHANNEL_TYPES = [
  "EMAIL",
  "SMS",
  "VOICE",
  "SLACK",
  "DISCORD",
  "TELEGRAM",
  "MICROSOFT_TEAMS",
  "WEBHOOK",
  "PAGERDUTY",
  "OPSGENIE",
] as const;

const createChannelSchema = z.object({
  type: z.enum(SUPPORTED_CHANNEL_TYPES),
  name: z.string().trim().min(1).max(200),
  config: z.record(z.unknown()),
});

const updateChannelSchema = createChannelSchema.partial();

const listQuerySchema = paginationQuerySchema.extend({
  type: z.enum(SUPPORTED_CHANNEL_TYPES).optional(),
});

function actorOf(req: Request): AlertChannelActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
  };
}

function channelIdOf(req: Request): string {
  const id = req.params.channelId;
  if (typeof id !== "string" || id.length === 0)
    throw AppError.notFound("Alert channel not found.");
  return id;
}

export interface AlertChannelsRouterDeps {
  prisma: PrismaClient;
  channels: AlertChannelService;
}

export function alertChannelsRouter(deps: AlertChannelsRouterDeps): Router {
  const router = Router({ mergeParams: true });

  router.use(orgContext(deps.prisma));

  // ── List ────────────────────────────────────────────────────────────────────
  router.get(
    "/",
    requirePermission("alertChannel", "read"),
    validate({ query: listQuerySchema }),
    async (req, res, next) => {
      try {
        const query = getValidated<AlertChannelListQuery>(req, "query");
        const page = await deps.channels.list(req.orgContext!.organizationId, query);
        res.json(page);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Create ──────────────────────────────────────────────────────────────────
  router.post(
    "/",
    requirePermission("alertChannel", "create"),
    validate({ body: createChannelSchema }),
    async (req, res, next) => {
      try {
        const input = getValidated<CreateAlertChannelInput>(req, "body");
        const channel = await deps.channels.create(
          req.orgContext!.organizationId,
          input,
          actorOf(req),
        );
        res.status(201).json(channel);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Get ─────────────────────────────────────────────────────────────────────
  router.get("/:channelId", requirePermission("alertChannel", "read"), async (req, res, next) => {
    try {
      const detail = await deps.channels.get(req.orgContext!.organizationId, channelIdOf(req));
      if (!detail) throw AppError.notFound("Alert channel not found.");
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // ── Update ──────────────────────────────────────────────────────────────────
  router.patch(
    "/:channelId",
    requirePermission("alertChannel", "update"),
    validate({ body: updateChannelSchema }),
    async (req, res, next) => {
      try {
        const input = getValidated<UpdateAlertChannelInput>(req, "body");
        const detail = await deps.channels.update(
          req.orgContext!.organizationId,
          channelIdOf(req),
          input,
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Alert channel not found.");
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Enable / Disable ────────────────────────────────────────────────────────
  router.post(
    "/:channelId/enable",
    requirePermission("alertChannel", "update"),
    async (req, res, next) => {
      try {
        const detail = await deps.channels.enable(
          req.orgContext!.organizationId,
          channelIdOf(req),
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Alert channel not found.");
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    "/:channelId/disable",
    requirePermission("alertChannel", "update"),
    async (req, res, next) => {
      try {
        const detail = await deps.channels.disable(
          req.orgContext!.organizationId,
          channelIdOf(req),
          actorOf(req),
        );
        if (!detail) throw AppError.notFound("Alert channel not found.");
        res.json(detail);
      } catch (err) {
        next(err);
      }
    },
  );

  // ── Delete ──────────────────────────────────────────────────────────────────
  router.delete(
    "/:channelId",
    requirePermission("alertChannel", "delete"),
    async (req, res, next) => {
      try {
        const deleted = await deps.channels.remove(
          req.orgContext!.organizationId,
          channelIdOf(req),
          actorOf(req),
        );
        if (!deleted) throw AppError.notFound("Alert channel not found.");
        res.json({ success: true });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
