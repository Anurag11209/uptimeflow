import { describe, expect, it } from "vitest";
import {
  assignableRoles,
  hasPermission,
  hasScopePermission,
  inviteMemberSchema,
  isOrgRole,
  isValidScope,
  listMembersQuerySchema,
  paginationQuerySchema,
  passwordSchema,
  rolePermissions,
  scopeAllows,
  slugSchema,
} from "../src/index.js";

describe("RBAC matrix", () => {
  it("grants owners every action including organization deletion", () => {
    expect(hasPermission("owner", "organization", ["delete"])).toBe(true);
    expect(hasPermission("owner", "billing", ["manage"])).toBe(true);
    expect(hasPermission("owner", "monitor", ["create", "delete"])).toBe(true);
  });

  it("prevents admins from deleting the organization or managing billing", () => {
    expect(hasPermission("admin", "organization", ["update"])).toBe(true);
    expect(hasPermission("admin", "organization", ["delete"])).toBe(false);
    expect(hasPermission("admin", "billing", ["read"])).toBe(true);
    expect(hasPermission("admin", "billing", ["manage"])).toBe(false);
    expect(hasPermission("admin", "member", ["create", "update", "delete"])).toBe(true);
  });

  it("lets managers run the team and operations but not delete members or manage billing", () => {
    expect(hasPermission("manager", "member", ["create", "update"])).toBe(true);
    expect(hasPermission("manager", "member", ["delete"])).toBe(false);
    expect(hasPermission("manager", "invitation", ["create", "cancel"])).toBe(true);
    expect(hasPermission("manager", "billing", ["read"])).toBe(true);
    expect(hasPermission("manager", "billing", ["manage"])).toBe(false);
    expect(hasPermission("manager", "monitor", ["create", "update", "delete"])).toBe(true);
    expect(hasPermission("manager", "auditLog", ["read"])).toBe(true);
  });

  it("lets developers operate resources but not people, billing, or audit logs", () => {
    expect(hasPermission("developer", "monitor", ["create", "update", "delete"])).toBe(true);
    expect(hasPermission("developer", "statusPage", ["delete"])).toBe(true);
    expect(hasPermission("developer", "apiKey", ["create", "revoke"])).toBe(true);
    expect(hasPermission("developer", "member", ["read"])).toBe(false);
    expect(hasPermission("developer", "invitation", ["create"])).toBe(false);
    expect(hasPermission("developer", "auditLog", ["read"])).toBe(false);
  });

  it("keeps viewer strictly read-only", () => {
    expect(hasPermission("viewer", "monitor", ["read"])).toBe(true);
    expect(hasPermission("viewer", "auditLog", ["read"])).toBe(true);
    for (const resource of ["organization", "member", "monitor", "statusPage"] as const) {
      expect(hasPermission("viewer", resource, ["update" as never])).toBe(false);
    }
  });

  it("rejects unknown roles outright", () => {
    expect(isOrgRole("superadmin")).toBe(false);
    expect(hasPermission("superadmin", "monitor", ["read"])).toBe(false);
    expect(assignableRoles("developer")).toEqual([]);
  });

  it("constrains role delegation to each role's authority", () => {
    expect(assignableRoles("owner")).toContain("owner");
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(assignableRoles("manager")).toEqual(["developer", "viewer"]);
    expect(assignableRoles("viewer")).toEqual([]);
  });

  it("declares a permission set for every role", () => {
    expect(Object.keys(rolePermissions).sort()).toEqual(
      ["admin", "developer", "manager", "owner", "viewer"].sort(),
    );
  });
});

describe("API key scopes", () => {
  it("matches exact, resource-wildcard, and global scopes", () => {
    expect(scopeAllows(["monitor:read"], "monitor", "read")).toBe(true);
    expect(scopeAllows(["monitor:read"], "monitor", "create")).toBe(false);
    expect(scopeAllows(["monitor:*"], "monitor", "delete")).toBe(true);
    expect(scopeAllows(["*"], "billing", "manage")).toBe(true);
    expect(scopeAllows(["monitor:*"], "statusPage", "read")).toBe(false);
  });

  it("requires every action to be granted", () => {
    expect(hasScopePermission(["monitor:read", "monitor:create"], "monitor", ["read", "create"])).toBe(
      true,
    );
    expect(hasScopePermission(["monitor:read"], "monitor", ["read", "delete"])).toBe(false);
  });

  it("validates scope strings against the permission matrix", () => {
    expect(isValidScope("*")).toBe(true);
    expect(isValidScope("monitor:*")).toBe(true);
    expect(isValidScope("monitor:read")).toBe(true);
    expect(isValidScope("monitor:teleport")).toBe(false);
    expect(isValidScope("nonsense:read")).toBe(false);
    expect(isValidScope("monitor")).toBe(false);
    expect(isValidScope("monitor:read:extra")).toBe(false);
  });
});

describe("validation schemas", () => {
  it("rejects invalid invitation payloads", () => {
    expect(inviteMemberSchema.safeParse({ email: "not-an-email", role: "developer" }).success).toBe(
      false,
    );
    expect(inviteMemberSchema.safeParse({ email: "a@b.co", role: "owner" }).success).toBe(false);
    const ok = inviteMemberSchema.safeParse({ email: "ADA@Example.com ", role: "viewer" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBe("ada@example.com");
  });

  it("clamps pagination limits and defaults sensibly", () => {
    expect(paginationQuerySchema.parse({}).limit).toBe(25);
    expect(paginationQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(paginationQuerySchema.parse({ limit: "100" }).limit).toBe(100);
  });

  it("enforces a length-first password policy", () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(12)).success).toBe(true);
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });

  it("enforces URL-safe organization slugs", () => {
    expect(slugSchema.safeParse("acme-prod").success).toBe(true);
    expect(slugSchema.safeParse("-bad").success).toBe(false);
    expect(slugSchema.safeParse("Bad Slug").success).toBe(false);
  });

  it("accepts member list filters", () => {
    const parsed = listMembersQuerySchema.parse({ query: "ada", role: "admin", limit: "10" });
    expect(parsed).toMatchObject({ query: "ada", role: "admin", limit: 10 });
  });
});
