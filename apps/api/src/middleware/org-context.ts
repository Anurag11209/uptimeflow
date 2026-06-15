import type { RequestHandler } from "express";
import { AppError, isOrgRole } from "@backend-uptime/shared";
import type { PrismaClient } from "@backend-uptime/db";

const ORG_SELECT = {
  id: true,
  name: true,
  slug: true,
  logo: true,
  createdAt: true,
} as const;

/**
 * Resolves the active organization for req.params.organizationId and attaches
 * it as req.orgContext, for either principal set by `authenticate`:
 *
 *   • session  → the caller must be a member; their role drives RBAC.
 *   • api key  → the key is bound to one org; its scopes drive RBAC.
 *
 * Returns 404 (not 403) when a session caller isn't a member, or when an API
 * key is used against a different org, so outsiders cannot probe which
 * organization ids exist.
 */
export function orgContext(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    // Express types route params as `string | string[]`; narrow to a single
    // string before it reaches the Prisma `where` filter.
    const organizationId = req.params.organizationId;
    if (typeof organizationId !== "string" || organizationId.length === 0) {
      next(new AppError("bad_request", "Missing organization id."));
      return;
    }

    // ── API-key principal ────────────────────────────────────────────────
    if (req.apiKey) {
      if (req.apiKey.organizationId !== organizationId) {
        next(AppError.notFound("Organization not found."));
        return;
      }
      const organization = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: ORG_SELECT,
      });
      if (!organization) {
        next(AppError.notFound("Organization not found."));
        return;
      }
      req.orgContext = {
        organizationId,
        organization,
        principal: { type: "apiKey", apiKeyId: req.apiKey.id, scopes: req.apiKey.scopes },
      };
      next();
      return;
    }

    // ── Session principal ────────────────────────────────────────────────
    const user = req.sessionData?.user;
    if (!user) {
      next(AppError.unauthorized());
      return;
    }

    const membership = await prisma.member.findFirst({
      where: { organizationId, userId: user.id },
      include: { organization: { select: ORG_SELECT } },
    });
    if (!membership) {
      next(AppError.notFound("Organization not found."));
      return;
    }
    if (!isOrgRole(membership.role)) {
      next(AppError.forbidden("Your role in this organization is not recognized."));
      return;
    }

    req.orgContext = {
      organizationId,
      organization: membership.organization,
      principal: {
        type: "session",
        userId: user.id,
        memberId: membership.id,
        role: membership.role,
      },
    };
    next();
  };
}
