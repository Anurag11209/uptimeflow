import type { OrgRole } from "@backend-uptime/shared";

/**
 * Structural session types. The real values come from Better Auth's
 * `auth.api.getSession()`; keeping our own narrow interfaces here decouples
 * middleware/services from Better Auth's inferred types and makes test
 * doubles trivial to construct.
 */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  image?: string | null;
  twoFactorEnabled?: boolean | null;
  createdAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  activeOrganizationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface SessionData {
  user: SessionUser;
  session: SessionRecord;
}

/** Resolves a session from request headers (wrapped Better Auth call). */
export type GetSession = (headers: Headers) => Promise<SessionData | null>;

/** Fetch-style handler for the mounted Better Auth routes. */
export type AuthHandler = (request: Request) => Promise<Response>;

export interface OrgInfo {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
}

/**
 * The authenticated principal acting inside an organization. A `session`
 * principal is a member authorized by their org role; an `apiKey` principal is
 * a machine credential authorized by its granted scopes. `requirePermission`
 * resolves both against the same shared permission matrix.
 */
export type Principal =
  | { type: "session"; userId: string; memberId: string; role: OrgRole }
  | { type: "apiKey"; apiKeyId: string; scopes: string[] };

export interface OrgContext {
  organizationId: string;
  organization: OrgInfo;
  principal: Principal;
}

/** Resolved API-key credential attached by the authenticate middleware. */
export interface ApiKeyContext {
  id: string;
  name: string;
  organizationId: string;
  scopes: string[];
}

export interface ValidatedInput {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      sessionData?: SessionData;
      apiKey?: ApiKeyContext;
      orgContext?: OrgContext;
      validated?: ValidatedInput;
      /** Set by requireResource: the tenant-checked resource for this route. */
      resource?: unknown;
    }
  }
}
