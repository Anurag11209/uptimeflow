import { describe, expect, it } from "vitest";
import {
  formatLimit,
  formatPrice,
  hasActivePaidSubscription,
  statusTone,
  switchKind,
  usagePercent,
  type BillingSummary,
} from "../lib/billing";

describe("formatPrice", () => {
  it("renders Free for zero and a monthly price otherwise", () => {
    expect(formatPrice(0)).toBe("Free");
    expect(formatPrice(2900, "usd")).toBe("$29/mo");
    expect(formatPrice(9900, "usd")).toBe("$99/mo");
  });
});

describe("formatLimit", () => {
  it("treats null as unlimited", () => {
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(250)).toBe("250");
  });
});

describe("usagePercent", () => {
  it("computes a clamped percentage", () => {
    expect(usagePercent(5, 10)).toBe(50);
    expect(usagePercent(20, 10)).toBe(100); // clamped
    expect(usagePercent(3, null)).toBe(0); // unlimited
    expect(usagePercent(1, 0)).toBe(100); // zero limit is fully consumed
  });
});

describe("switchKind", () => {
  it("classifies a tier change relative to the current plan", () => {
    expect(switchKind("FREE", "FREE")).toBe("current");
    expect(switchKind("FREE", "GROWTH")).toBe("upgrade");
    expect(switchKind("BUSINESS", "STARTER")).toBe("downgrade");
  });
});

describe("hasActivePaidSubscription", () => {
  const summary = (over: Partial<BillingSummary["subscription"]>): BillingSummary =>
    ({
      subscription: {
        plan: "GROWTH",
        status: "ACTIVE",
        seats: 1,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        canceledAt: null,
        hasStripeCustomer: true,
        ...over,
      },
      plan: { limits: {}, usage: {} },
    }) as unknown as BillingSummary;

  it("is true for a live paid plan", () => {
    expect(hasActivePaidSubscription(summary({}))).toBe(true);
  });
  it("is false on FREE, without a customer, or when undefined", () => {
    expect(hasActivePaidSubscription(summary({ plan: "FREE" }))).toBe(false);
    expect(hasActivePaidSubscription(summary({ hasStripeCustomer: false }))).toBe(false);
    expect(hasActivePaidSubscription(undefined)).toBe(false);
  });
});

describe("statusTone", () => {
  it("maps subscription statuses to badge tones", () => {
    expect(statusTone("ACTIVE")).toBe("up");
    expect(statusTone("TRIALING")).toBe("brand");
    expect(statusTone("PAST_DUE")).toBe("down");
    expect(statusTone("CANCELED")).toBe("muted");
  });
});
