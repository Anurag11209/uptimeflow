import { Router } from "express";
import type { PrismaClient } from "@backend-uptime/db";

/**
 * GET /v1/me — the signed-in user, their organization memberships, and the
 * active organization from the session. The web app calls this once on load
 * to hydrate the org switcher.
 */
export function meRouter(deps: { prisma: PrismaClient }): Router {
  const router = Router();

  router.get("/", async (req, res) => {
    // requireSession runs before this router.
    const { user, session } = req.sessionData!;

    const memberships = await deps.prisma.member.findMany({
      where: { userId: user.id },
      include: {
        organization: {
          select: { id: true, name: true, slug: true, logo: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
        twoFactorEnabled: user.twoFactorEnabled ?? false,
        createdAt: user.createdAt,
      },
      activeOrganizationId: session.activeOrganizationId ?? null,
      memberships: memberships.map((member) => ({
        id: member.id,
        role: member.role,
        joinedAt: member.createdAt,
        organization: member.organization,
      })),
    });
  });

  return router;
}
