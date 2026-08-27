import { APIError } from "better-auth/api";

/**
 * The slice of the API's PlanLimitsService that seat enforcement needs.
 *
 * Injected rather than imported: the plan catalog lives in the API service,
 * and this package must not depend on it (the dependency runs the other way).
 * Same pattern as the injected `auditLog` sink.
 */
export interface SeatLimitGate {
  /** Rejects when the org is already at its seat cap. */
  assertSeatAvailable(organizationId: string): Promise<void>;
  /** Rejects when members + outstanding invitations are already at the cap. */
  assertSeatAvailableForInvite(organizationId: string): Promise<void>;
}

/** Error carrying the API's typed error code, as thrown by AppError. */
interface CodedError {
  code?: unknown;
  message?: unknown;
  details?: unknown;
}

/**
 * Runs a seat assertion inside a Better Auth hook, translating the API's
 * `payment_required` AppError into a real 402. Without this the AppError would
 * escape as an unhandled 500 and read as a bug rather than as "out of seats".
 *
 * Any other failure propagates untouched — if the plan lookup itself breaks,
 * the request must fail, never silently grant a seat.
 */
export async function enforceSeat(assert: () => Promise<void>): Promise<void> {
  try {
    await assert();
  } catch (error) {
    const err = error as CodedError;
    if (err?.code === "payment_required") {
      throw new APIError("PAYMENT_REQUIRED", {
        code: "PLAN_SEAT_LIMIT_REACHED",
        message: typeof err.message === "string" ? err.message : "Seat limit reached.",
        details: err.details,
      });
    }
    throw error;
  }
}

/**
 * Plan seat enforcement for the organization plugin.
 *
 * Every path that can grow an organization runs through one of these three
 * hooks — there is no other way in, because the API exposes no membership
 * mutations of its own (member.service.ts is read-only by design).
 *
 * Invitations are gated against members + outstanding invitations, so an org
 * can never hold more claims than it has seats. Accepting an invitation then
 * only converts a claim that was already paid for, which is what keeps a burst
 * of concurrent accepts from landing the org over its cap.
 *
 * A `gate` of undefined disables enforcement (tests, local dev without plans).
 */
export function createSeatEnforcementHooks(gate: SeatLimitGate | undefined) {
  return {
    beforeCreateInvitation: async ({
      invitation,
    }: {
      invitation: { organizationId: string };
    }): Promise<void> => {
      if (!gate) return;
      await enforceSeat(() => gate.assertSeatAvailableForInvite(invitation.organizationId));
    },

    beforeAcceptInvitation: async ({
      invitation,
    }: {
      invitation: { organizationId: string };
    }): Promise<void> => {
      if (!gate) return;
      // Re-checked at accept time as well: the org may have downgraded since,
      // or the invitation may predate enforcement entirely.
      await enforceSeat(() => gate.assertSeatAvailable(invitation.organizationId));
    },

    beforeAddMember: async ({
      member,
    }: {
      member: { organizationId: string };
    }): Promise<void> => {
      if (!gate) return;
      await enforceSeat(() => gate.assertSeatAvailable(member.organizationId));
    },
  };
}
