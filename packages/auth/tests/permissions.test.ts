import { describe, expect, it } from "vitest";
import { ORG_ROLES, hasPermission } from "@backend-uptime/shared";
import { orgAccessRoles } from "../src/permissions.js";

describe("Better Auth access-control bridge", () => {
  it("defines a Better Auth role for every shared org role", () => {
    expect(Object.keys(orgAccessRoles).sort()).toEqual([...ORG_ROLES].sort());
  });

  it("mirrors the shared matrix for representative checks", () => {
    const cases = [
      { role: "owner", resource: "organization", action: "delete" },
      { role: "admin", resource: "organization", action: "delete" },
      { role: "admin", resource: "invitation", action: "create" },
      { role: "manager", resource: "member", action: "create" },
      { role: "manager", resource: "member", action: "delete" },
      { role: "developer", resource: "monitor", action: "create" },
      { role: "developer", resource: "member", action: "read" },
      { role: "viewer", resource: "monitor", action: "read" },
      { role: "viewer", resource: "monitor", action: "create" },
    ] as const;

    for (const { role, resource, action } of cases) {
      const expected = hasPermission(role, resource, [action as never]);
      const result = orgAccessRoles[role].authorize({ [resource]: [action] } as never);
      expect(result.success, `${role} → ${resource}:${action}`).toBe(expected);
    }
  });
});
