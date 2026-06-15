import { createAuthClient } from "better-auth/react";
import { organizationClient, twoFactorClient } from "better-auth/client/plugins";
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";
import {
  ORG_ROLES,
  permissionStatements,
  rolePermissions,
  type OrgRole,
} from "@backend-uptime/shared";

/**
 * Client mirror of the server access-control model
 * (packages/auth/src/permissions.ts), built from the same shared matrix. Without
 * it, the organization client types invite/role-change calls with Better Auth's
 * default roles and rejects our custom roles (manager, developer, viewer). The
 * imports here are all client-safe — no server-only code is pulled in.
 */
const ac = createAccessControl({ ...defaultStatements, ...permissionStatements } as const);

type AnyRole = ReturnType<typeof ac.newRole>;

const roles = Object.fromEntries(
  ORG_ROLES.map((role) => {
    const grants = Object.fromEntries(
      Object.entries(rolePermissions[role]).map(([resource, actions]) => [
        resource,
        [...(actions as readonly string[])],
      ]),
    );
    return [role, ac.newRole(grants as Parameters<typeof ac.newRole>[0])] as const;
  }),
) as Record<OrgRole, AnyRole>;

/**
 * Better Auth browser client.
 *
 * Talks directly to the API service (cross-origin), so every request carries
 * credentials. The organization plugin powers org CRUD / invitations /
 * role changes; custom read-heavy endpoints live under /v1 on the API and are
 * consumed through lib/api.ts instead.
 */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  plugins: [
    organizationClient({ ac, roles }),
    twoFactorClient({
      onTwoFactorRedirect() {
        // Triggered when sign-in requires a TOTP code.
        window.location.href = "/two-factor";
      },
    }),
  ],
});

export const { useSession, useListOrganizations } = authClient;
