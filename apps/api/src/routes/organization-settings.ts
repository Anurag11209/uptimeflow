import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { OrgSettingsService, SettingsActor } from "../services/organization-settings.service.js";

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with single hyphens.");

const region = z.enum([
  "NA_EAST",
  "NA_WEST",
  "EU_WEST",
  "EU_CENTRAL",
  "AP_SOUTHEAST",
  "AP_NORTHEAST",
  "SA_EAST",
  "AF_SOUTH",
]);

const updateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    slug: slugSchema,
    logo: z.string().trim().url().max(2048).nullable(),
    timezone: z.string().trim().max(64).nullable(),
    billingContact: z.string().trim().email().max(320).nullable(),
    defaultRegion: region.nullable(),
    defaultAlertPolicyId: z.string().uuid().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, "At least one field is required.");

export interface OrgSettingsRouterDeps {
  prisma: PrismaClient;
  orgSettings: OrgSettingsService;
}

function actorOf(req: Request): SettingsActor {
  const principal = req.orgContext!.principal;
  return {
    userId: principal.type === "session" ? principal.userId : null,
    actorType: principal.type === "session" ? "user" : "api_key",
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

/**
 * Organization settings under /v1/organizations/:organizationId/settings.
 * Read gated by `organization:read` (any member); writes by
 * `organization:update` (owner/admin), matching the RBAC matrix.
 */
export function organizationSettingsRouter(deps: OrgSettingsRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(orgContext(deps.prisma));

  router.get("/", requirePermission("organization", "read"), async (req, res) => {
    const settings = await deps.orgSettings.get(req.orgContext!.organizationId);
    if (!settings) throw AppError.notFound("Organization not found.");
    res.json(settings);
  });

  router.patch(
    "/",
    requirePermission("organization", "update"),
    validate({ body: updateSchema }),
    async (req, res) => {
      const input = getValidated<z.infer<typeof updateSchema>>(req, "body");
      try {
        const settings = await deps.orgSettings.update(
          req.orgContext!.organizationId,
          input,
          actorOf(req),
        );
        if (!settings) throw AppError.notFound("Organization not found.");
        res.json(settings);
      } catch (err) {
        if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
          throw AppError.conflict("That slug is already taken.");
        }
        throw err;
      }
    },
  );

  return router;
}
