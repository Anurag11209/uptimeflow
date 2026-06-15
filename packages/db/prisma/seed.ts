/**
 * Development seed.
 *
 * Password hashing is owned by Better Auth (scrypt with its own parameters),
 * so the seed does NOT fabricate credential accounts. Instead it:
 *   1. creates verified users + an organization + memberships for every role,
 *   2. leaves credentials empty — sign in locally with the magic of
 *      `pnpm seed:passwords` is intentionally absent; use "Forgot password"
 *      from the web app (emails land in Mailpit at http://localhost:8025)
 *      or sign up fresh and run this seed afterwards to join the demo org.
 *
 * Idempotent: safe to run repeatedly.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_ORG = { id: "org_demo", name: "Acme Status", slug: "acme-status" };

const DEMO_USERS: { id: string; name: string; email: string; role: string }[] = [
  { id: "usr_owner", name: "Ada Owner", email: "owner@acme.test", role: "owner" },
  { id: "usr_admin", name: "Alan Admin", email: "admin@acme.test", role: "admin" },
  { id: "usr_manager", name: "Maya Manager", email: "manager@acme.test", role: "manager" },
  { id: "usr_developer", name: "Devon Dev", email: "dev@acme.test", role: "developer" },
  { id: "usr_viewer", name: "Vik Viewer", email: "viewer@acme.test", role: "viewer" },
];

async function main(): Promise<void> {
  await prisma.organization.upsert({
    where: { id: DEMO_ORG.id },
    update: { name: DEMO_ORG.name, slug: DEMO_ORG.slug },
    create: { ...DEMO_ORG, createdAt: new Date() },
  });

  for (const user of DEMO_USERS) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: { name: user.name, email: user.email },
      create: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
      },
    });
    await prisma.member.upsert({
      where: { organizationId_userId: { organizationId: DEMO_ORG.id, userId: user.id } },
      update: { role: user.role },
      create: {
        id: `mem_${user.id}`,
        organizationId: DEMO_ORG.id,
        userId: user.id,
        role: user.role,
      },
    });
  }

  await prisma.auditLog.createMany({
    data: [
      {
        id: randomUUID(),
        organizationId: DEMO_ORG.id,
        actorId: "usr_owner",
        actorType: "user",
        action: "organization.created",
        resourceType: "organization",
        resourceId: DEMO_ORG.id,
        metadata: { seed: true },
      },
      ...DEMO_USERS.filter((u) => u.role !== "owner").map((u) => ({
        id: randomUUID(),
        organizationId: DEMO_ORG.id,
        actorId: "usr_owner",
        actorType: "user",
        action: "member.joined",
        resourceType: "member",
        resourceId: `mem_${u.id}`,
        metadata: { seed: true, role: u.role },
      })),
    ],
    skipDuplicates: true,
  });

  console.log(`Seeded org "${DEMO_ORG.name}" with ${DEMO_USERS.length} members.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
