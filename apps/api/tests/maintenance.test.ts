import { describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { createMaintenanceWindowService } from "../src/services/maintenance-window.service.js";
import type { MaintenanceWindowService } from "../src/services/maintenance-window.service.js";
import type { AuditLogService } from "../src/services/audit-log.service.js";
import { buildServer, headerGetSession } from "./helpers.js";

function prismaWithRole(role: string | null): PrismaClient {
  return {
    $queryRaw: async () => [{ ok: 1 }],
    member: {
      findFirst: async (args: { where: { organizationId: string; userId: string } }) =>
        role
          ? {
              id: "mem_1",
              role,
              organizationId: args.where.organizationId,
              userId: args.where.userId,
              organization: {
                id: args.where.organizationId,
                name: "Acme",
                slug: "acme",
                logo: null,
                createdAt: new Date(),
              },
            }
          : null,
    },
  } as unknown as PrismaClient;
}

// A fake service just to satisfy the Express router so we can test HTTP responses
const fakeMaintenanceService: MaintenanceWindowService = {
  list: vi.fn(async () => []),
  create: vi.fn(
    async () =>
      ({ id: "win_1", title: "Test Window", startsAt: new Date(), endsAt: new Date() }) as any,
  ),
  delete: vi.fn(async () => true),
};

const BASE = "/v1/organizations/org_demo/maintenance-windows";
const app = (role: string | null) =>
  buildServer({
    prisma: prismaWithRole(role),
    getSession: headerGetSession,
    services: { maintenanceWindows: fakeMaintenanceService } as any,
  });

describe("Maintenance Windows Routes (RBAC & Validation)", () => {
  it("viewer can read the maintenance list", async () => {
    const res = await request(app("viewer")).get(BASE).set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(fakeMaintenanceService.list).toHaveBeenCalled();
  });

  it("viewer is forbidden from creating a maintenance window", async () => {
    const res = await request(app("viewer")).post(BASE).set("x-test-user", "u1").send({
      title: "Unauthorized Patch",
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      monitorIds: [],
    });
    expect(res.status).toBe(403);
  });

  it("admin/owner can create a maintenance window", async () => {
    const res = await request(app("admin")).post(BASE).set("x-test-user", "u1").send({
      title: "Authorized Patch",
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      monitorIds: [],
    });
    expect(res.status).toBe(201);
  });

  it("rejects creation if required fields (title) are missing", async () => {
    const res = await request(app("owner")).post(BASE).set("x-test-user", "u1").send({
      startsAt: new Date().toISOString(),
      endsAt: new Date().toISOString(),
      monitorIds: [],
    });
    expect(res.status).toBe(400); // Zod validation failure
  });

  it("admin/owner can delete a maintenance window", async () => {
    const res = await request(app("admin")).delete(`${BASE}/win_123`).set("x-test-user", "u1");
    expect(res.status).toBe(200);
  });
});

function svcPrisma(opts: {
  windowsList?: unknown[];
  existingWindow?: unknown | null;
}): PrismaClient {
  return {
    maintenanceWindow: {
      findMany: vi.fn(async () => opts.windowsList ?? []),
      create: vi.fn(async (args: any) => ({ id: "win_new", ...args.data })),
      findFirst: vi.fn(async () =>
        opts.existingWindow !== undefined ? opts.existingWindow : null,
      ),
      update: vi.fn(async (args: any) => ({ id: args.where.id, deletedAt: new Date() })),
    },
  } as unknown as PrismaClient;
}

// Mock the audit log service so we can spy on it
const fakeAuditLogs = {
  log: vi.fn(async () => {}),
} as unknown as AuditLogService;

describe("Maintenance Windows Service Logic", () => {
  it("list() returns only active windows based on DB query", async () => {
    const mockPrisma = svcPrisma({
      windowsList: [{ id: "win_1", title: "Active DB Maintenance" }],
    });
    const svc = createMaintenanceWindowService({ prisma: mockPrisma, auditLogs: fakeAuditLogs });

    const results = await svc.list("org_1");
    expect(results).toHaveLength(1);
    expect(mockPrisma.maintenanceWindow.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }), // Ensures we don't fetch soft-deleted items
      }),
    );
  });

  it("create() inserts into the DB and writes an audit log", async () => {
    const mockPrisma = svcPrisma({});
    const svc = createMaintenanceWindowService({ prisma: mockPrisma, auditLogs: fakeAuditLogs });

    const input = {
      title: "New Window",
      startsAt: new Date(),
      endsAt: new Date(),
      monitorIds: ["mon_1"],
    };

    const res = await svc.create("org_1", "user_1", input);

    expect(res.title).toBe("New Window");
    expect(mockPrisma.maintenanceWindow.create).toHaveBeenCalledOnce();
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "maintenance_window.created",
        resourceId: "win_new",
      }),
    );
  });

  it("delete() soft-deletes an existing window and writes an audit log", async () => {
    const mockPrisma = svcPrisma({
      existingWindow: { id: "win_123", organizationId: "org_1" },
    });
    const svc = createMaintenanceWindowService({ prisma: mockPrisma, auditLogs: fakeAuditLogs });

    const success = await svc.delete("org_1", "user_1", "win_123");

    expect(success).toBe(true);
    expect(mockPrisma.maintenanceWindow.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "win_123" },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }), // Verifies the soft-delete logic
      }),
    );
    expect(fakeAuditLogs.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "maintenance_window.deleted",
        resourceId: "win_123",
      }),
    );
  });

  it("delete() throws NOT_FOUND if the window does not exist or belongs to another org", async () => {
    const mockPrisma = svcPrisma({
      existingWindow: null, // Simulates window not found
    });
    const svc = createMaintenanceWindowService({ prisma: mockPrisma, auditLogs: fakeAuditLogs });

    await expect(svc.delete("org_1", "user_1", "win_123")).rejects.toThrow("NOT_FOUND");
    expect(mockPrisma.maintenanceWindow.update).not.toHaveBeenCalled();
  });
});
