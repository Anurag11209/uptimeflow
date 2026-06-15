/**
 * Canonical RBAC definition for Backend Uptime.
 *
 * This file is the single source of truth for organization roles and
 * permissions. It is consumed by:
 *   - `@backend-uptime/auth`  → converted into Better Auth access-control roles
 *   - `apps/api`              → request-time permission checks (middleware)
 *   - `apps/web`              → UI gating (hide actions the member cannot take)
 *
 * Resources for later phases (monitor, statusPage, alertChannel, …) are
 * declared now so the matrix is stable as the product grows.
 */

export const ORG_ROLES = ["owner", "admin", "manager", "developer", "viewer"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  developer: "Developer",
  viewer: "Viewer",
};

/** Every protectable resource and the actions it supports. */
export const permissionStatements = {
  organization: ["read", "update", "delete"],
  member: ["read", "create", "update", "delete"],
  invitation: ["read", "create", "cancel"],
  billing: ["read", "manage"],
  auditLog: ["read"],
  apiKey: ["read", "create", "revoke"],
  // Phase 2+ resources, declared up front so role grants never churn:
  monitor: ["read", "create", "update", "delete"],
  statusPage: ["read", "create", "update", "delete"],
  alertChannel: ["read", "create", "update", "delete"],
  escalationPolicy: ["read", "create", "update", "delete"],
  onCallSchedule: ["read", "create", "update", "delete"],
} as const;

export type Resource = keyof typeof permissionStatements;
export type ActionFor<R extends Resource> = (typeof permissionStatements)[R][number];
export type PermissionSet = { [R in Resource]?: readonly ActionFor<R>[] };

const ALL: PermissionSet = Object.fromEntries(
  Object.entries(permissionStatements).map(([resource, actions]) => [resource, [...actions]]),
) as PermissionSet;

const READ_EVERYTHING: PermissionSet = Object.fromEntries(
  Object.entries(permissionStatements)
    .filter(([, actions]) => (actions as readonly string[]).includes("read"))
    .map(([resource]) => [resource, ["read"]]),
) as PermissionSet;

/** Full CRUD on every operational (non-people, non-billing) resource. */
const OPERATE: PermissionSet = {
  monitor: ["read", "create", "update", "delete"],
  statusPage: ["read", "create", "update", "delete"],
  alertChannel: ["read", "create", "update", "delete"],
  escalationPolicy: ["read", "create", "update", "delete"],
  onCallSchedule: ["read", "create", "update", "delete"],
};

/**
 * The role → permission matrix.
 *
 *  owner      everything, including organization deletion, billing, and ownership transfer
 *  admin      everything except deleting the org and managing billing
 *  manager    runs the team and operations: manage members/invitations (no removal),
 *             full CRUD on monitoring resources and API keys, read billing + audit
 *  developer  hands-on operator: full CRUD on monitoring resources and API keys,
 *             but no access to people, billing, or audit logs
 *  viewer     read-everything, change nothing
 */
export const rolePermissions: Record<OrgRole, PermissionSet> = {
  owner: ALL,
  admin: {
    ...ALL,
    organization: ["read", "update"],
    billing: ["read"],
  },
  manager: {
    organization: ["read"],
    member: ["read", "create", "update"],
    invitation: ["read", "create", "cancel"],
    billing: ["read"],
    auditLog: ["read"],
    apiKey: ["read", "create", "revoke"],
    ...OPERATE,
  },
  developer: {
    organization: ["read"],
    apiKey: ["read", "create", "revoke"],
    ...OPERATE,
  },
  viewer: READ_EVERYTHING,
};

export function isOrgRole(value: unknown): value is OrgRole {
  return typeof value === "string" && (ORG_ROLES as readonly string[]).includes(value);
}

/** Check whether `role` may perform every action in `actions` on `resource`. */
export function hasPermission<R extends Resource>(
  role: string,
  resource: R,
  actions: readonly ActionFor<R>[],
): boolean {
  if (!isOrgRole(role)) return false;
  const granted = rolePermissions[role][resource] as readonly string[] | undefined;
  if (!granted) return false;
  return actions.every((action) => granted.includes(action));
}

/**
 * Which roles a given role may assign to others. Each role may only delegate
 * roles at or below its own authority, and only owners may create other owners
 * (and only via ownership transfer).
 */
export function assignableRoles(actorRole: string): OrgRole[] {
  if (actorRole === "owner") return [...ORG_ROLES];
  if (actorRole === "admin") return ["admin", "manager", "developer", "viewer"];
  if (actorRole === "manager") return ["developer", "viewer"];
  return [];
}

// ───────────────────────── API key scopes ───────────────────────────
//
// API keys authorize by scope rather than by role. A scope is one of:
//   "*"                 — every action on every resource
//   "<resource>:*"      — every action on one resource (e.g. "monitor:*")
//   "<resource>:<action>" — a single action (e.g. "monitor:read")
// where <resource>/<action> are drawn from `permissionStatements`, so keys can
// never be granted a permission the role model doesn't recognise.

/** Whether `scopes` grant a single action on a resource. */
export function scopeAllows(scopes: readonly string[], resource: string, action: string): boolean {
  return scopes.some(
    (s) => s === "*" || s === `${resource}:*` || s === `${resource}:${action}`,
  );
}

/** Whether `scopes` grant every action in `actions` on `resource`. */
export function hasScopePermission<R extends Resource>(
  scopes: readonly string[],
  resource: R,
  actions: readonly ActionFor<R>[],
): boolean {
  return actions.every((action) => scopeAllows(scopes, resource, action));
}

/** Validate a scope string against the permission matrix (for key creation). */
export function isValidScope(scope: string): boolean {
  if (scope === "*") return true;
  const [resource, action, ...rest] = scope.split(":");
  if (rest.length > 0 || !resource || !action) return false;
  if (!(resource in permissionStatements)) return false;
  if (action === "*") return true;
  const actions = permissionStatements[resource as Resource] as readonly string[];
  return actions.includes(action);
}
