import { describe, expect, it, vi } from "vitest";
import { APIError } from "better-auth/api";
import { createSeatEnforcementHooks, enforceSeat, type SeatLimitGate } from "../src/seat-limits.js";

/** Mirrors the shape AppError produces in the API service. */
function paymentRequired(message = "Out of seats.", details?: unknown): Error {
  return Object.assign(new Error(message), { code: "payment_required", details });
}

function gate(over: Partial<SeatLimitGate> = {}): SeatLimitGate {
  return {
    assertSeatAvailable: async () => {},
    assertSeatAvailableForInvite: async () => {},
    ...over,
  };
}

const INVITE = { invitation: { organizationId: "org_1" } };
const MEMBER = { member: { organizationId: "org_1" } };

describe("enforceSeat", () => {
  it("translates payment_required into a 402 APIError", async () => {
    const err = await enforceSeat(async () => {
      throw paymentRequired("Your Free plan allows 1 seats.", { limit: 1 });
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(APIError);
    expect((err as APIError).status).toBe("PAYMENT_REQUIRED");
    expect((err as APIError).body?.message).toContain("Free plan allows 1 seats");
  });

  it("passes unrelated failures through untouched — a broken plan lookup must not grant a seat", async () => {
    const boom = new Error("connection refused");
    await expect(
      enforceSeat(async () => {
        throw boom;
      }),
    ).rejects.toBe(boom);
  });

  it("resolves when the assertion passes", async () => {
    await expect(enforceSeat(async () => {})).resolves.toBeUndefined();
  });
});

describe("seat enforcement hooks", () => {
  it("beforeCreateInvitation gates on members + outstanding invitations", async () => {
    const assertSeatAvailableForInvite = vi.fn(async () => {
      throw paymentRequired();
    });
    const hooks = createSeatEnforcementHooks(gate({ assertSeatAvailableForInvite }));

    await expect(hooks.beforeCreateInvitation(INVITE)).rejects.toBeInstanceOf(APIError);
    expect(assertSeatAvailableForInvite).toHaveBeenCalledWith("org_1");
  });

  it("beforeAcceptInvitation re-checks the seat cap at accept time", async () => {
    const assertSeatAvailable = vi.fn(async () => {
      throw paymentRequired();
    });
    const hooks = createSeatEnforcementHooks(gate({ assertSeatAvailable }));

    await expect(hooks.beforeAcceptInvitation(INVITE)).rejects.toBeInstanceOf(APIError);
    expect(assertSeatAvailable).toHaveBeenCalledWith("org_1");
  });

  it("beforeAddMember gates direct membership adds", async () => {
    const assertSeatAvailable = vi.fn(async () => {
      throw paymentRequired();
    });
    const hooks = createSeatEnforcementHooks(gate({ assertSeatAvailable }));

    await expect(hooks.beforeAddMember(MEMBER)).rejects.toBeInstanceOf(APIError);
    expect(assertSeatAvailable).toHaveBeenCalledWith("org_1");
  });

  it("every membership-growth hook is wired — none silently missing", () => {
    const hooks = createSeatEnforcementHooks(gate());
    expect(Object.keys(hooks).sort()).toEqual([
      "beforeAcceptInvitation",
      "beforeAddMember",
      "beforeCreateInvitation",
    ]);
  });

  it("allows the operation when the org is under its cap", async () => {
    const hooks = createSeatEnforcementHooks(gate());
    await expect(hooks.beforeCreateInvitation(INVITE)).resolves.toBeUndefined();
    await expect(hooks.beforeAcceptInvitation(INVITE)).resolves.toBeUndefined();
    await expect(hooks.beforeAddMember(MEMBER)).resolves.toBeUndefined();
  });

  it("uses the organization on the hook payload, never a caller-supplied id", async () => {
    const seen: string[] = [];
    const hooks = createSeatEnforcementHooks(
      gate({
        assertSeatAvailable: async (id) => {
          seen.push(id);
        },
        assertSeatAvailableForInvite: async (id) => {
          seen.push(id);
        },
      }),
    );

    await hooks.beforeCreateInvitation({ invitation: { organizationId: "org_a" } });
    await hooks.beforeAcceptInvitation({ invitation: { organizationId: "org_b" } });
    await hooks.beforeAddMember({ member: { organizationId: "org_c" } });

    expect(seen).toEqual(["org_a", "org_b", "org_c"]);
  });

  it("no gate injected = no enforcement (local dev / tests)", async () => {
    const hooks = createSeatEnforcementHooks(undefined);
    await expect(hooks.beforeCreateInvitation(INVITE)).resolves.toBeUndefined();
  });
});
