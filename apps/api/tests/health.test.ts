import { describe, expect, it } from "vitest";
import request from "supertest";
import type { PrismaClient } from "@backend-uptime/db";
import { buildServer } from "./helpers.js";

describe("infrastructure endpoints", () => {
  it("GET /healthz responds ok", async () => {
    const res = await request(buildServer()).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("GET /readyz is 200 when dependencies respond", async () => {
    const res = await request(buildServer()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ready", checks: { postgres: "ok", redis: "ok" } });
  });

  it("GET /readyz degrades to 503 when redis is down", async () => {
    const app = buildServer({
      redis: {
        ping: async () => {
          throw new Error("connection refused");
        },
      },
    });
    const res = await request(app).get("/readyz");
    expect(res.status).toBe(503);
    expect(res.body.checks.redis).toBe("failed");
    expect(res.body.checks.postgres).toBe("ok");
  });

  it("honors a well-formed inbound X-Request-Id", async () => {
    const res = await request(buildServer())
      .get("/healthz")
      .set("X-Request-Id", "req-12345678");
    expect(res.headers["x-request-id"]).toBe("req-12345678");
  });
});

describe("error envelope", () => {
  it("returns 401 envelope for unauthenticated /v1/me", async () => {
    const res = await request(buildServer()).get("/v1/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("unauthorized");
    expect(res.body.error.requestId).toBeTruthy();
  });

  it("returns 404 envelope for unknown routes", async () => {
    const res = await request(buildServer()).get("/v1/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("returns 400 envelope for malformed JSON bodies", async () => {
    const res = await request(buildServer())
      .post("/v1/me")
      .set("content-type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("masks internal errors as 500 with a stable envelope", async () => {
    const prisma = {
      $queryRaw: async () => [{ ok: 1 }],
      member: {
        findMany: async () => {
          throw new Error("secret database detail");
        },
        findFirst: async () => null,
      },
    } as unknown as PrismaClient;
    const { headerGetSession } = await import("./helpers.js");
    const app = buildServer({ prisma, getSession: headerGetSession });
    const res = await request(app).get("/v1/me").set("x-test-user", "usr_1");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe("internal_error");
    expect(res.body.error.message).toBe("Internal server error.");
    expect(JSON.stringify(res.body)).not.toContain("secret database detail");
  });
});

describe("better auth mount", () => {
  it("delegates /api/auth/* to the auth handler", async () => {
    const res = await request(buildServer()).get("/api/auth/anything");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
