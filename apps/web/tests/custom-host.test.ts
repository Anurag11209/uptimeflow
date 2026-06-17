import { describe, expect, it } from "vitest";
import { hostname, isAppHost, isCustomHostCandidate, parseAppHosts } from "../lib/custom-host";

describe("parseAppHosts", () => {
  it("always includes localhost + 127.0.0.1 and merges configured hosts", () => {
    expect(parseAppHosts("uptimeflow.app, www.uptimeflow.app")).toEqual([
      "localhost",
      "127.0.0.1",
      "uptimeflow.app",
      "www.uptimeflow.app",
    ]);
    expect(parseAppHosts(undefined)).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("hostname / isAppHost", () => {
  const appHosts = parseAppHosts("uptimeflow.app");
  it("strips port + lowercases", () => {
    expect(hostname("Status.Acme.com:443")).toBe("status.acme.com");
  });
  it("recognizes app hosts vs custom domains", () => {
    expect(isAppHost("uptimeflow.app", appHosts)).toBe(true);
    expect(isAppHost("localhost:3000", appHosts)).toBe(true);
    expect(isAppHost("status.acme.com", appHosts)).toBe(false);
  });
});

describe("isCustomHostCandidate", () => {
  const appHosts = parseAppHosts("uptimeflow.app");

  it("is true for a custom host on a normal path", () => {
    expect(isCustomHostCandidate("status.acme.com", "/", appHosts)).toBe(true);
  });

  it("is false for the app's own hosts (dashboard guard path untouched)", () => {
    expect(isCustomHostCandidate("uptimeflow.app", "/dashboard/billing", appHosts)).toBe(false);
    expect(isCustomHostCandidate("localhost:3000", "/", appHosts)).toBe(false);
  });

  it("does not re-rewrite status pages, assets, the API, or _next", () => {
    expect(isCustomHostCandidate("status.acme.com", "/status/acme", appHosts)).toBe(false);
    expect(isCustomHostCandidate("status.acme.com", "/_next/data", appHosts)).toBe(false);
    expect(isCustomHostCandidate("status.acme.com", "/api/x", appHosts)).toBe(false);
    expect(isCustomHostCandidate("status.acme.com", "/favicon.ico", appHosts)).toBe(false);
  });

  it("is false when there is no host header", () => {
    expect(isCustomHostCandidate("", "/", appHosts)).toBe(false);
  });
});
