import type { RequestHandler } from "express";
import {
  AppError,
  hasPermission,
  hasScopePermission,
  type ActionFor,
  type Resource,
} from "@backend-uptime/shared";

/**
 * RBAC gate. Must run after authenticate + orgContext. Resolves the request's
 * principal against the shared permission model — by role for session members,
 * by scope for API keys — with no extra queries (the same matrix Better Auth
 * enforces on its own organization endpoints).
 */
export function requirePermission<R extends Resource>(
  resource: R,
  ...actions: ActionFor<R>[]
): RequestHandler {
  return (req, _res, next) => {
    const ctx = req.orgContext;
    if (!ctx) {
      next(AppError.unauthorized());
      return;
    }

    const allowed =
      ctx.principal.type === "session"
        ? hasPermission(ctx.principal.role, resource, actions)
        : hasScopePermission(ctx.principal.scopes, resource, actions);

    if (!allowed) {
      const subject =
        ctx.principal.type === "session"
          ? `Your role (${ctx.principal.role})`
          : "This API key";
      next(
        AppError.forbidden(
          `${subject} does not allow ${actions.join(",")} on ${resource}.`,
        ),
      );
      return;
    }
    next();
  };
}
