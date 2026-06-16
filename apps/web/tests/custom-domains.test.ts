import { describe, expect, it } from "vitest";
import { isValidDomain } from "@backend-uptime/shared";
import { sslMeta, verificationMeta } from "../lib/custom-domains";

describe("verificationMeta", () => {
  it("maps verification statuses to label + tone", () => {
    expect(verificationMeta("VERIFIED")).toEqual({ label: "Verified", tone: "up" });
    expect(verificationMeta("FAILED")).toEqual({ label: "Check failed", tone: "down" });
    expect(verificationMeta("PENDING")).toEqual({ label: "Pending DNS", tone: "muted" });
  });
});

describe("sslMeta", () => {
  it("maps ssl statuses to label + tone", () => {
    expect(sslMeta("ACTIVE")).toEqual({ label: "SSL active", tone: "up" });
    expect(sslMeta("FAILED")).toEqual({ label: "SSL failed", tone: "down" });
    expect(sslMeta("PENDING")).toEqual({ label: "SSL pending", tone: "muted" });
  });
});

describe("client-side domain validation (shared)", () => {
  it("accepts valid hostnames and rejects junk before hitting the API", () => {
    expect(isValidDomain("status.acme.com")).toBe(true);
    expect(isValidDomain("not a domain")).toBe(false);
    expect(isValidDomain("https://status.acme.com")).toBe(true);
  });
});
