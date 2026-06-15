import { describe, expect, it } from "vitest";
import { EmailConfigError, parseEmailConfig } from "@backend-uptime/config/email";

describe("parseEmailConfig", () => {
  it("applies defaults (us-east-1, no static credentials)", () => {
    const config = parseEmailConfig({});
    expect(config).toMatchObject({
      region: "us-east-1",
      from: "alerts@uptimeflow.in",
      maxRetries: 3,
      hasStaticCredentials: false,
    });
  });

  it("detects static credentials when both keys are present", () => {
    const config = parseEmailConfig({
      AWS_REGION: "us-east-1",
      AWS_ACCESS_KEY_ID: "AKIA...",
      AWS_SECRET_ACCESS_KEY: "secret",
      EMAIL_FROM: "alerts@uptimeflow.in",
    });
    expect(config.hasStaticCredentials).toBe(true);
    expect(config.accessKeyId).toBe("AKIA...");
  });

  it("accepts a display-name From and coerces EMAIL_MAX_RETRIES", () => {
    const config = parseEmailConfig({ EMAIL_FROM: "UptimeFlow <alerts@uptimeflow.in>", EMAIL_MAX_RETRIES: "5" });
    expect(config.from).toBe("UptimeFlow <alerts@uptimeflow.in>");
    expect(config.maxRetries).toBe(5);
  });

  it("throws a readable error for an invalid EMAIL_FROM", () => {
    expect(() => parseEmailConfig({ EMAIL_FROM: "not-an-email" })).toThrow(EmailConfigError);
  });
});
