import type { RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { AppError } from "@backend-uptime/shared";
import type { GetSession } from "../context.js";

/**
 * Resolves the Better Auth session (cookie-based) and attaches it to the
 * request. 401s when absent or expired. Email verification is enforced by
 * Better Auth at sign-in, so a live session implies a verified user.
 */
export function requireSession(getSession: GetSession): RequestHandler {
  return async (req, _res, next) => {
    const data = await getSession(fromNodeHeaders(req.headers));
    if (!data) {
      next(AppError.unauthorized());
      return;
    }
    req.sessionData = data;
    next();
  };
}
