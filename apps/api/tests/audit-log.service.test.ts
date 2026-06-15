import { describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import type { PrismaClient } from "@backend-uptime/db";
import { decodeCursor, encodeCursor } from "@backend-uptime/shared";
import { createAuditLogService } from "../src/services/audit-log.service.js";

function makeRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `log_${String(i).padStart(3, "0")}`,
    organizationId: "org_1",
    actorId: "usr_1",
    actorType: "user",
    action: "member.invited",
    resourceType: "invitation",
    resourceId: `inv_${i}`,
    ipAddress: null,
    userAgent: null,
    metadata: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, count - i)),
  }));
}

describe("audit log service", () => {
  it("writes events with defaults applied", async () => {
    const create = vi.fn(async () => ({}));
    const prisma = { auditLog: { create } } as unknown as PrismaClient;
    const service = createAuditLogService({ prisma, logger: pino({ level: "silent" }) });

    await service.log({
      actorType: "user",
      actorId: "usr_1",
      action: "user.signed_in",
      resourceType: "session",
    });

    expect(create).toHaveBeenCalledOnce();
    const data = create.mock.calls[0]![0].data;
    expect(data.organizationId).toBeNull();
    expect(data.action).toBe("user.signed_in");
  });

  it("never throws when the write fails", async () => {
    const prisma = {
      auditLog: {
        create: async () => {
          throw new Error("db down");
        },
      },
    } as unknown as PrismaClient;
    const service = createAuditLogService({ prisma, logger: pino({ level: "silent" }) });

    await expect(
      service.log({ actorType: "system", action: "user.signed_up", resourceType: "user" }),
    ).resolves.toBeUndefined();
  });

  it("paginates with a stable keyset cursor", async () => {
    const rows = makeRows(26);
    const findMany = vi.fn(async ({ take }: { take: number }) => rows.slice(0, take));
    const prisma = { auditLog: { findMany } } as unknown as PrismaClient;
    const service = createAuditLogService({ prisma, logger: pino({ level: "silent" }) });

    const page = await service.list("org_1", { limit: 25 });
    expect(page.items).toHaveLength(25);
    expect(page.nextCursor).toBeTruthy();

    const cursor = decodeCursor(page.nextCursor!);
    expect(cursor?.id).toBe(page.items[24]!.id);
    expect(findMany.mock.calls[0]![0].take).toBe(26);
  });

  it("applies filters and cursor conditions to the where clause", async () => {
    const findMany = vi.fn(async () => []);
    const prisma = { auditLog: { findMany } } as unknown as PrismaClient;
    const service = createAuditLogService({ prisma, logger: pino({ level: "silent" }) });

    const cursor = encodeCursor({ id: "log_010", createdAt: "2026-01-01T00:00:10.000Z" });
    await service.list("org_1", {
      limit: 10,
      cursor,
      action: "member.invited",
      from: new Date("2025-12-01T00:00:00Z"),
    });

    const where = findMany.mock.calls[0]![0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { organizationId: "org_1" },
        { action: "member.invited" },
        expect.objectContaining({ OR: expect.any(Array) }),
      ]),
    );
  });

  it("rejects malformed cursors with a 400 AppError", async () => {
    const prisma = { auditLog: { findMany: async () => [] } } as unknown as PrismaClient;
    const service = createAuditLogService({ prisma, logger: pino({ level: "silent" }) });

    await expect(service.list("org_1", { limit: 10, cursor: "!!garbage!!" })).rejects.toMatchObject(
      { code: "bad_request" },
    );
  });
});
