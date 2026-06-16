import { AppError } from "@backend-uptime/shared";
import type { PrismaClient, PlanTier } from "@backend-uptime/db";

/** Countable resources whose creation is capped by the plan. */
export type LimitedResource = "monitor" | "seat" | "statusPage";

/** Boolean plan capabilities (forward-looking metered channels gate on these). */
export type Capability = "sms" | "voice" | "sso" | "advancedAnalytics";

export interface EffectiveLimits {
  tier: PlanTier;
  planName: string;
  monitorLimit: number | null; // null = unlimited
  seatLimit: number | null;
  statusPageLimit: number | null;
  smsEnabled: boolean;
  voiceEnabled: boolean;
  ssoEnabled: boolean;
  advancedAnalytics: boolean;
  /** Included metered units per metric, e.g. { sms: 500, voice_minutes: 0 }. */
  meteredAllowances: Record<string, number>;
}

export interface ResourceUsage {
  limit: number | null;
  used: number;
  /** null when the limit is unlimited. */
  remaining: number | null;
}

export interface PlanSummary {
  limits: EffectiveLimits;
  usage: {
    monitor: ResourceUsage;
    seat: ResourceUsage;
    statusPage: ResourceUsage;
    /** Metered usage in the current billing period, per metric. */
    metered: Record<string, { used: number; included: number }>;
  };
}

/** Hardcoded FREE defaults — only used if the billing_plans catalog is empty
 *  (it is seeded, so this is a safety net, not the source of truth). */
const FREE_FALLBACK: EffectiveLimits = {
  tier: "FREE",
  planName: "Free",
  monitorLimit: 10,
  seatLimit: 1,
  statusPageLimit: 1,
  smsEnabled: false,
  voiceEnabled: false,
  ssoEnabled: false,
  advancedAnalytics: false,
  meteredAllowances: { sms: 0, voice_minutes: 0 },
};

const RESOURCE_LABEL: Record<LimitedResource, string> = {
  monitor: "monitors",
  seat: "seats",
  statusPage: "status pages",
};

const CAPABILITY_LABEL: Record<Capability, string> = {
  sms: "SMS alerts",
  voice: "voice calls",
  sso: "SSO",
  advancedAnalytics: "advanced analytics",
};

export interface PlanLimitsService {
  getEffectiveLimits(organizationId: string): Promise<EffectiveLimits>;
  getSummary(organizationId: string): Promise<PlanSummary>;
  countUsage(organizationId: string, resource: LimitedResource): Promise<number>;
  /** Throw payment_required (402) if creating one more `resource` would exceed the plan. */
  assertWithinLimit(organizationId: string, resource: LimitedResource): Promise<void>;
  /** Throw payment_required (402) if the plan does not include `capability`. */
  assertCapability(organizationId: string, capability: Capability): Promise<void>;
}

export function createPlanLimitsService(deps: { prisma: PrismaClient }): PlanLimitsService {
  const { prisma } = deps;

  async function getEffectiveLimits(organizationId: string): Promise<EffectiveLimits> {
    const subscription = await prisma.subscription.findUnique({
      where: { organizationId },
      include: { billingPlan: true },
    });

    const plan =
      subscription?.billingPlan ??
      (await prisma.billingPlan.findUnique({ where: { tier: subscription?.plan ?? "FREE" } }));

    if (!plan) return FREE_FALLBACK;

    return {
      tier: plan.tier,
      planName: plan.name,
      // A per-subscription monitor override (if set) wins over the plan default.
      monitorLimit: subscription?.monitorLimit ?? plan.monitorLimit,
      seatLimit: plan.seatLimit,
      statusPageLimit: plan.statusPageLimit,
      smsEnabled: plan.smsEnabled,
      voiceEnabled: plan.voiceEnabled,
      ssoEnabled: plan.ssoEnabled,
      advancedAnalytics: plan.advancedAnalytics,
      meteredAllowances: (plan.meteredAllowances as Record<string, number> | null) ?? {},
    };
  }

  async function countUsage(organizationId: string, resource: LimitedResource): Promise<number> {
    switch (resource) {
      case "monitor":
        return prisma.monitor.count({ where: { organizationId, deletedAt: null } });
      case "seat":
        return prisma.member.count({ where: { organizationId } });
      case "statusPage":
        return prisma.statusPage.count({ where: { organizationId, deletedAt: null } });
    }
  }

  function limitFor(limits: EffectiveLimits, resource: LimitedResource): number | null {
    switch (resource) {
      case "monitor":
        return limits.monitorLimit;
      case "seat":
        return limits.seatLimit;
      case "statusPage":
        return limits.statusPageLimit;
    }
  }

  async function assertWithinLimit(organizationId: string, resource: LimitedResource): Promise<void> {
    const limits = await getEffectiveLimits(organizationId);
    const limit = limitFor(limits, resource);
    if (limit === null) return; // unlimited
    const used = await countUsage(organizationId, resource);
    if (used >= limit) {
      throw AppError.paymentRequired(
        `Your ${limits.planName} plan allows ${limit} ${RESOURCE_LABEL[resource]}. ` +
          `Upgrade your plan to add more.`,
        { resource, limit, used, tier: limits.tier },
      );
    }
  }

  async function assertCapability(organizationId: string, capability: Capability): Promise<void> {
    const limits = await getEffectiveLimits(organizationId);
    const enabled =
      capability === "sms"
        ? limits.smsEnabled
        : capability === "voice"
          ? limits.voiceEnabled
          : capability === "sso"
            ? limits.ssoEnabled
            : limits.advancedAnalytics;
    if (!enabled) {
      throw AppError.paymentRequired(
        `${CAPABILITY_LABEL[capability]} is not included in your ${limits.planName} plan. ` +
          `Upgrade to enable it.`,
        { capability, tier: limits.tier },
      );
    }
  }

  async function getSummary(organizationId: string): Promise<PlanSummary> {
    const limits = await getEffectiveLimits(organizationId);
    const [monitors, seats, statusPages] = await Promise.all([
      countUsage(organizationId, "monitor"),
      countUsage(organizationId, "seat"),
      countUsage(organizationId, "statusPage"),
    ]);

    const toUsage = (limit: number | null, used: number): ResourceUsage => ({
      limit,
      used,
      remaining: limit === null ? null : Math.max(0, limit - used),
    });

    // Metered usage in the current billing period (calendar month as the
    // period anchor until per-subscription periods are wired into metering).
    const periodStart = startOfMonthUtc();
    const usageByMetric = await prisma.usageRecord.groupBy({
      by: ["metric"],
      where: { organizationId, periodStart: { gte: periodStart } },
      _sum: { quantity: true },
    });
    const metered: Record<string, { used: number; included: number }> = {};
    for (const [metric, included] of Object.entries(limits.meteredAllowances)) {
      metered[metric] = { used: 0, included };
    }
    for (const row of usageByMetric) {
      metered[row.metric] = {
        used: row._sum.quantity ?? 0,
        included: limits.meteredAllowances[row.metric] ?? 0,
      };
    }

    return {
      limits,
      usage: {
        monitor: toUsage(limits.monitorLimit, monitors),
        seat: toUsage(limits.seatLimit, seats),
        statusPage: toUsage(limits.statusPageLimit, statusPages),
        metered,
      },
    };
  }

  return { getEffectiveLimits, getSummary, countUsage, assertWithinLimit, assertCapability };
}

/** First instant of the current UTC month — the metering period anchor. */
function startOfMonthUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
