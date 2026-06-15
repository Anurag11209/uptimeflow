import type { Request, RequestHandler } from "express";
import { AppError } from "@backend-uptime/shared";

export interface ResourceLoader<T> {
  /** Fetch the resource by id, or null when it does not exist. */
  load(id: string): Promise<T | null>;
  /** The organization a loaded resource belongs to. */
  orgOf(resource: T): string;
}

/**
 * Resource-level authorization. Runs after orgContext. Loads the resource named
 * by the `:<paramName>` route param, confirms it belongs to the active
 * organization, and stashes it on `req.resource` for the handler.
 *
 * Returns 404 (not 403) when the resource is missing OR lives in another org —
 * the same existence-privacy rule the org guard uses, so the API never confirms
 * that a cross-tenant id exists.
 */
export function requireResource<T>(paramName: string, loader: ResourceLoader<T>): RequestHandler {
  return async (req, _res, next) => {
    const ctx = req.orgContext;
    if (!ctx) {
      next(AppError.unauthorized());
      return;
    }

    const id = req.params[paramName];
    if (typeof id !== "string" || id.length === 0) {
      next(AppError.notFound());
      return;
    }

    const resource = await loader.load(id);
    if (!resource || loader.orgOf(resource) !== ctx.organizationId) {
      next(AppError.notFound());
      return;
    }

    req.resource = resource;
    next();
  };
}

/** Typed accessor for the resource attached by requireResource. */
export function getResource<T>(req: Request): T {
  return req.resource as T;
}
