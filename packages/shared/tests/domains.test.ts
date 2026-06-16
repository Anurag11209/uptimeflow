import { describe, expect, it } from "vitest";
import {
  buildDnsInstructions,
  challengeHostname,
  isValidDomain,
  normalizeDomain,
} from "../src/domains.js";

describe("normalizeDomain", () => {
  it("lowercases, trims, and strips scheme/path/port/trailing-dot", () => {
    expect(normalizeDomain("  Status.Acme.COM ")).toBe("status.acme.com");
    expect(normalizeDomain("https://status.acme.com/path")).toBe("status.acme.com");
    expect(normalizeDomain("status.acme.com:8080")).toBe("status.acme.com");
    expect(normalizeDomain("status.acme.com.")).toBe("status.acme.com");
  });

  it("accepts multi-level subdomains", () => {
    expect(normalizeDomain("a.b.c.example.co.uk")).toBe("a.b.c.example.co.uk");
  });

  it("rejects invalid inputs", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("nodot")).toBeNull();
    expect(normalizeDomain("*.acme.com")).toBeNull(); // wildcard
    expect(normalizeDomain("192.168.0.1")).toBeNull(); // IPv4
    expect(normalizeDomain("acme.123")).toBeNull(); // numeric TLD
    expect(normalizeDomain("-bad.acme.com")).toBeNull(); // leading hyphen label
    expect(normalizeDomain("a".repeat(64) + ".com")).toBeNull(); // label too long
  });

  it("isValidDomain mirrors normalizeDomain", () => {
    expect(isValidDomain("status.acme.com")).toBe(true);
    expect(isValidDomain("nope")).toBe(false);
  });
});

describe("buildDnsInstructions", () => {
  it("produces a TXT challenge and a routing CNAME", () => {
    const dns = buildDnsInstructions({
      domain: "status.acme.com",
      token: "tok123",
      cnameTarget: "cname.uptimeflow.app",
    });
    expect(dns.txtRecord).toEqual({
      type: "TXT",
      name: "_uptimeflow-challenge.status.acme.com",
      value: "tok123",
    });
    expect(dns.cnameRecord).toEqual({
      type: "CNAME",
      name: "status.acme.com",
      value: "cname.uptimeflow.app",
    });
  });

  it("challengeHostname matches the TXT record name", () => {
    expect(challengeHostname("status.acme.com")).toBe("_uptimeflow-challenge.status.acme.com");
  });
});
