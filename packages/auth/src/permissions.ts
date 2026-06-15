import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import {
  ORG_ROLES,
  permissionStatements,
  rolePermissions,
  type OrgRole,
} from "@backend-uptime/shared";

/**
 * The statement set is our shared matrix merged over Better Auth's
 * organization defaults, so the plugin's built-in checks (invite member,
 * update role, remove member, update/delete organization) and our custom
 * resources (monitor, billing, auditLog, …) all flow through one model.
 */
const statement = {
  ...defaultStatements,
  ...permissionStatements,
} as const;

export const ac = createAccessControl(statement);

type AnyRole = ReturnType<typeof ac.newRole>;

function buildRoles(): Record<OrgRole, AnyRole> {
  const entries = ORG_ROLES.map((role) => {
    // The shared matrix uses readonly tuples; Better Auth wants mutable arrays.
    const grants = Object.fromEntries(
      Object.entries(rolePermissions[role]).map(([resource, actions]) => [
        resource,
        [...(actions as readonly string[])],
      ]),
    );
    return [role, ac.newRole(grants as Parameters<typeof ac.newRole>[0])] as const;
  });
  return Object.fromEntries(entries) as Record<OrgRole, AnyRole>;
}

/** Better Auth role objects, one per organization role. */
export const orgAccessRoles = buildRoles();
