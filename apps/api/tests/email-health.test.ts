import { describe, expect, it } from "vitest";
import request from "supertest";
import type { EmailProvider } from "@backend-uptime/notifications";
import { buildServer } from "./helpers.js";

function providerStub(health: Awaited<ReturnType<EmailProvider["healthCheck"]>>): EmailProvider {
  return {
    name: "ses",
    sendEmail: async () => ({ messageId: null, provider: "ses" }),
    sendBulkEmail: async () => ({ sent: 0, failed: 0, results: [] }),
    healthCheck: async () => health,
  };
}

describe("GET /internal/email/health", () => {
  it("returns 200 with provider/status/region when healthy", async () => {
    const app = buildServer({
      emailProvider: providerStub({ provider: "ses", status: "healthy", region: "us-east-1" }),
    });
    const res = await request(app).get("/internal/email/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ provider: "ses", status: "healthy", region: "us-east-1" });
  });

  it("returns 503 when the provider is unhealthy", async () => {
    const app = buildServer({
      emailProvider: providerStub({ provider: "ses", status: "unhealthy", region: "us-east-1", detail: "AccessDenied" }),
    });
    const res = await request(app).get("/internal/email/health");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("unhealthy");
  });

  it("defaults to the logging provider when none is injected", async () => {
    const res = await request(buildServer()).get("/internal/email/health");
    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("logging");
  });
});
