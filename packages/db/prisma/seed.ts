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
import "dotenv/config";

import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type PlanTier, type Prisma } from "@prisma/client";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

/**
 * Plan catalog — seeded as DATA (single source of truth for limits & flags).
 * null limit = unlimited. Stripe price/product ids are read from the
 * environment when present (so the catalog matches the Stripe dashboard
 * without hardcoding ids), otherwise left null until configured. ENTERPRISE is
 * flag-only (isPublic=false): no self-serve checkout, limits negotiated.
 */
const PLANS: Array<{
  tier: PlanTier;
  name: string;
  description: string;
  priceCents: number;
  monitorLimit: number | null;
  seatLimit: number | null;
  statusPageLimit: number | null;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  ssoEnabled: boolean;
  advancedAnalytics: boolean;
  customDomainsEnabled: boolean;
  meteredAllowances: Prisma.InputJsonValue;
  isPublic: boolean;
  sortOrder: number;
}> = [
  {
    tier: "FREE",
    name: "Free",
    description: "10 monitors, 1 seat, 1 status page.",
    priceCents: 0,
    monitorLimit: 10,
    seatLimit: 1,
    statusPageLimit: 1,
    smsEnabled: false,
    voiceEnabled: false,
    ssoEnabled: false,
    advancedAnalytics: false,
    customDomainsEnabled: false,
    meteredAllowances: { sms: 0, voice_minutes: 0 },
    isPublic: true,
    sortOrder: 0,
  },
  {
    tier: "STARTER",
    name: "Starter",
    description: "50 monitors, 5 seats, Slack/Discord/Webhooks.",
    priceCents: 2900,
    monitorLimit: 50,
    seatLimit: 5,
    statusPageLimit: 1,
    smsEnabled: false,
    voiceEnabled: false,
    ssoEnabled: false,
    advancedAnalytics: false,
    customDomainsEnabled: false,
    meteredAllowances: { sms: 0, voice_minutes: 0 },
    isPublic: true,
    sortOrder: 1,
  },
  {
    tier: "GROWTH",
    name: "Growth",
    description: "250 monitors, 20 seats, SMS alerts, multiple status pages.",
    priceCents: 9900,
    monitorLimit: 250,
    seatLimit: 20,
    statusPageLimit: 10,
    smsEnabled: true,
    voiceEnabled: false,
    ssoEnabled: false,
    advancedAnalytics: false,
    customDomainsEnabled: true,
    meteredAllowances: { sms: 500, voice_minutes: 0 },
    isPublic: true,
    sortOrder: 2,
  },
  {
    tier: "BUSINESS",
    name: "Business",
    description: "Unlimited monitors, voice calls, advanced analytics, SSO.",
    priceCents: 29900,
    monitorLimit: null,
    seatLimit: null,
    statusPageLimit: null,
    smsEnabled: true,
    voiceEnabled: true,
    ssoEnabled: true,
    advancedAnalytics: true,
    customDomainsEnabled: true,
    meteredAllowances: { sms: 2000, voice_minutes: 200 },
    isPublic: true,
    sortOrder: 3,
  },
  {
    tier: "ENTERPRISE",
    name: "Enterprise",
    description: "Custom limits, SSO, voice, advanced analytics. Contact sales.",
    priceCents: 0,
    monitorLimit: null,
    seatLimit: null,
    statusPageLimit: null,
    smsEnabled: true,
    voiceEnabled: true,
    ssoEnabled: true,
    advancedAnalytics: true,
    customDomainsEnabled: true,
    meteredAllowances: {},
    isPublic: false,
    sortOrder: 4,
  },
];

/** Optional per-tier Stripe ids from env, e.g. STRIPE_PRICE_GROWTH / STRIPE_PRODUCT_GROWTH. */
function stripeIds(tier: PlanTier): { stripePriceId: string | null; stripeProductId: string | null } {
  return {
    stripePriceId: process.env[`STRIPE_PRICE_${tier}`] ?? null,
    stripeProductId: process.env[`STRIPE_PRODUCT_${tier}`] ?? null,
  };
}

async function seedPlans(): Promise<void> {
  for (const plan of PLANS) {
    const ids = stripeIds(plan.tier);
    await prisma.billingPlan.upsert({
      where: { tier: plan.tier },
      update: { ...plan, ...ids },
      create: { ...plan, ...ids },
    });
  }
  console.log(`Seeded ${PLANS.length} billing plans.`);
}

const DEMO_ORG = { id: "org_demo", name: "Acme Status", slug: "acme-status" };

const DEMO_USERS: { id: string; name: string; email: string; role: string }[] = [
  { id: "usr_owner", name: "Ada Owner", email: "owner@acme.test", role: "owner" },
  { id: "usr_admin", name: "Alan Admin", email: "admin@acme.test", role: "admin" },
  { id: "usr_manager", name: "Maya Manager", email: "manager@acme.test", role: "manager" },
  { id: "usr_developer", name: "Devon Dev", email: "dev@acme.test", role: "developer" },
  { id: "usr_viewer", name: "Vik Viewer", email: "viewer@acme.test", role: "viewer" },
];

async function main(): Promise<void> {
  await seedPlans();

  await prisma.organization.upsert({
    where: { id: DEMO_ORG.id },
    update: { name: DEMO_ORG.name, slug: DEMO_ORG.slug },
    create: { ...DEMO_ORG, createdAt: new Date() },
  });

  // Give the demo org a FREE subscription linked to the catalog row so the
  // billing dashboard has something to render out of the box.
  const freePlan = await prisma.billingPlan.findUnique({ where: { tier: "FREE" } });
  await prisma.subscription.upsert({
    where: { organizationId: DEMO_ORG.id },
    update: { planId: freePlan?.id ?? null },
    create: {
      organizationId: DEMO_ORG.id,
      plan: "FREE",
      status: "ACTIVE",
      planId: freePlan?.id ?? null,
      seats: 1,
    },
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
