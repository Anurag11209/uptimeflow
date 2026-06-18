import { Router } from "express";
import { z } from "zod";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { MaintenanceWindowService } from "../services/maintenance-window.service.js";

const createMaintenanceSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(1000).optional(),
    startsAt: z
      .string()
      .datetime()
      .transform((str) => new Date(str)),
    endsAt: z
      .string()
      .datetime()
      .transform((str) => new Date(str)),
    monitorIds: z.array(z.string().uuid()),
  })
  .refine((d) => d.startsAt < d.endsAt, {
    message: "endsAt must be logically after startsAt",
    path: ["endsAt"],
  });

export interface MaintenanceWindowsRouterDeps {
  prisma: PrismaClient;
  maintenanceWindows: MaintenanceWindowService;
}

export function maintenanceWindowsRouter(deps: MaintenanceWindowsRouterDeps): Router {
  const router = Router({ mergeParams: true });

  // Inject current organization into request context
  router.use(orgContext(deps.prisma));

  // GET: List all non-deleted windows
  router.get("/", requirePermission("monitor", "read"), async (req, res, next) => {
    try {
      const windows = await deps.maintenanceWindows.list(req.orgContext!.organizationId);
      res.json(windows);
    } catch (err) {
      next(err);
    }
  });

  // POST: Create a scheduled window
  router.post(
    "/",
    requirePermission("monitor", "update"),
    validate({ body: createMaintenanceSchema }),
    async (req, res, next) => {
      try {
        const input = getValidated<z.infer<typeof createMaintenanceSchema>>(req, "body");
        const principal = req.orgContext!.principal;

        const actor = {
          id: principal.type === "session" ? principal.userId : "api_key",
          type: (principal.type === "session" ? "user" : "api_key") as "user" | "api_key",
        };

        const newWindow = await deps.maintenanceWindows.create(
          req.orgContext!.organizationId,
          actor,
          input,
        );
        res.status(201).json(newWindow);
      } catch (error: any) {
        if (error.message === "INVALID_MONITOR") {
          return res
            .status(400)
            .json({ error: "One or more monitor IDs do not belong to this organization." });
        }
        next(error);
      }
    },
  );

  // DELETE: Soft-delete/Cancel a scheduled window
  router.delete("/:windowId", requirePermission("monitor", "update"), async (req, res, next) => {
    try {
      const principal = req.orgContext!.principal;
      const actor = {
        id: principal.type === "session" ? principal.userId : "api_key",
        type: (principal.type === "session" ? "user" : "api_key") as "user" | "api_key",
      };

      const windowId = req.params.windowId as string;

      await deps.maintenanceWindows.delete(req.orgContext!.organizationId, actor, windowId);

      res.status(200).json({ success: true });
    } catch (error: any) {
      if (error.message === "NOT_FOUND") {
        return res.status(404).json({ error: "Window not found" });
      }
      next(error);
    }
  });

  return router;
}
