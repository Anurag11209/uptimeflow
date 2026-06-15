import { Router } from "express";
import { z } from "zod";
import { isValidScope } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";
import { orgContext } from "../middleware/org-context.js";
import { requirePermission } from "../middleware/require-permission.js";
import { getResource, requireResource } from "../middleware/require-resource.js";
import { getValidated, validate } from "../middleware/validate.js";
import type { ApiKeyService } from "../services/api-key.service.js";

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z
    .array(z.string().refine(isValidScope, "Unknown scope (expected <resource>:<action>)."))
    .min(1)
    .max(50),
  // Optional absolute expiry; must be in the future.
  expiresAt: z.coerce.date().refine((d) => d.getTime() > Date.now(), "expiresAt must be in the future.").optional(),
});

type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

export interface ApiKeysRouterDeps {
  prisma: PrismaClient;
  apiKeys: ApiKeyService;
}

/**
 * Manage org-scoped API keys under
 * /v1/organizations/:organizationId/api-keys. Gated by the `apiKey` resource in
 * the RBAC matrix (owner/admin/manager/developer can manage; viewer reads).
 */
export function apiKeysRouter(deps: ApiKeysRouterDeps): Router {
  const router = Router({ mergeParams: true });

  router.use(orgContext(deps.prisma));

  router.get("/", requirePermission("apiKey", "read"), async (req, res) => {
    const items = await deps.apiKeys.list(req.orgContext!.organizationId);
    res.json({ items });
  });

  router.post(
    "/",
    requirePermission("apiKey", "create"),
    validate({ body: createApiKeySchema }),
    async (req, res) => {
      const body = getValidated<CreateApiKeyInput>(req, "body");
      const ctx = req.orgContext!;
      // Attribute creation to the human when a session created it; API keys
      // minting keys are recorded with no human actor.
      const createdById = ctx.principal.type === "session" ? ctx.principal.userId : null;

      const created = await deps.apiKeys.create({
        organizationId: ctx.organizationId,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt ?? null,
        createdById,
      });

      // `token` is the only time the plaintext is ever exposed.
      res.status(201).json(created);
    },
  );

  router.delete(
    "/:keyId",
    requirePermission("apiKey", "revoke"),
    // Resource-level check: the key must belong to the active org (else 404).
    requireResource("keyId", {
      load: (id) =>
        deps.prisma.apiKey.findUnique({
          where: { id },
          select: { id: true, organizationId: true },
        }),
      orgOf: (key) => key.organizationId,
    }),
    async (req, res) => {
      const key = getResource<{ id: string; organizationId: string }>(req);
      await deps.apiKeys.revoke(req.orgContext!.organizationId, key.id);
      res.status(204).end();
    },
  );

  return router;
}
