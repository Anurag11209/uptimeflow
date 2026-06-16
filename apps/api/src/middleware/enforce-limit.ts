import type { RequestHandler } from "express";
import { AppError } from "@backend-uptime/shared";
import type {
  Capability,
  LimitedResource,
  PlanLimitsService,
} from "../services/plan-limits.service.js";

/**
 * Plan-enforcement gates. Run AFTER authenticate + orgContext (they set
 * req.orgContext.organizationId) and typically AFTER requirePermission, so an
 * over-limit action fails with a clear typed 402 (payment_required) rather than
 * a 500 — and only for callers who were already allowed by RBAC.
 *
 * These are mountable directly in front of the creation route for a gated
 * resource, e.g. `router.post("/", requirePermission("monitor","create"),
 * enforceLimit(plans, "monitor"), handler)`.
 */
export function enforceLimit(plans: PlanLimitsService, resource: LimitedResource): RequestHandler {
  return (req, _res, next) => {
    const organizationId = req.orgContext?.organizationId;
    if (!organizationId) {
      next(AppError.unauthorized());
      return;
    }
    plans.assertWithinLimit(organizationId, resource).then(() => next(), next);
  };
}

/** Gate an action on a boolean plan capability (SMS/voice/SSO/analytics). */
export function requireCapability(plans: PlanLimitsService, capability: Capability): RequestHandler {
  return (req, _res, next) => {
    const organizationId = req.orgContext?.organizationId;
    if (!organizationId) {
      next(AppError.unauthorized());
      return;
    }
    plans.assertCapability(organizationId, capability).then(() => next(), next);
  };
}
