import type { Request, RequestHandler } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { AppError } from "@backend-uptime/shared";
import type { GetSession } from "../context.js";
import { API_KEY_PREFIX, type ApiKeyService } from "../services/api-key.service.js";

export interface AuthenticateDeps {
  getSession: GetSession;
  apiKeys: ApiKeyService;
}

const API_KEY_HEADER = "x-api-key";

/**
 * Pull an API key from the request: either the `X-API-Key` header or a
 * `Authorization: Bearer <key>` whose token carries the API-key prefix (so we
 * never mistake an unrelated bearer token for a key).
 */
export function extractApiKey(req: Request): string | null {
  const header = req.headers[API_KEY_HEADER];
  if (typeof header === "string" && header.length > 0) return header;

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token.startsWith(API_KEY_PREFIX)) return token;
  }
  return null;
}

/**
 * Unified authentication: an API key (machine principal) when one is presented,
 * otherwise the Better Auth cookie session (member principal). Exactly one of
 * `req.apiKey` / `req.sessionData` is set on success; 401 when neither resolves.
 * Authorization (role vs scope) is decided later by requirePermission.
 */
export function authenticate(deps: AuthenticateDeps): RequestHandler {
  return async (req, _res, next) => {
    const presented = extractApiKey(req);

    if (presented) {
      const key = await deps.apiKeys.verify(presented);
      if (!key) {
        next(AppError.unauthorized("Invalid or expired API key."));
        return;
      }
      req.apiKey = {
        id: key.id,
        name: key.name,
        organizationId: key.organizationId,
        scopes: key.scopes,
      };
      next();
      return;
    }

    const data = await deps.getSession(fromNodeHeaders(req.headers));
    if (!data) {
      next(AppError.unauthorized());
      return;
    }
    req.sessionData = data;
    next();
  };
}
