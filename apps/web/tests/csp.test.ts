import { describe, expect, it } from "vitest";
import { buildCsp, originOf } from "@/lib/csp";

/** Parse a policy string into directive → value for readable assertions. */
function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split(";").map((part) => {
      const [name, ...rest] = part.trim().split(/\s+/);
      return [name ?? "", rest.join(" ")];
    }),
  );
}

describe("buildCsp — script execution", () => {
  it("carries the request nonce in script-src", () => {
    expect(directives(buildCsp("abc123"))["script-src"]).toContain("'nonce-abc123'");
  });

  it("never allows 'unsafe-inline' in script-src", () => {
    // This is what stops an injected inline <script> from running even if a
    // future sink forgets to escape. Without it the CSP is decorative.
    expect(directives(buildCsp("n"))["script-src"]).not.toContain("unsafe-inline");
  });

  it("never allows 'unsafe-eval' in script-src", () => {
    expect(directives(buildCsp("n"))["script-src"]).not.toContain("unsafe-eval");
  });

  it("keeps 'self' and avoids strict-dynamic so prerendered chunks still load", () => {
    // Statically prerendered HTML has no request nonce on its <script src>
    // tags; 'strict-dynamic' would make CSP3 browsers ignore 'self' and block
    // every /_next/static chunk. 'self' does NOT authorize inline script, so
    // dropping strict-dynamic costs nothing against injected <script>.
    const scriptSrc = directives(buildCsp("n"))["script-src"];
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'strict-dynamic'");
  });

  it("blocks plugins and framing, and pins base-uri/form-action", () => {
    const d = directives(buildCsp("n"));
    expect(d["object-src"]).toBe("'none'");
    expect(d["frame-ancestors"]).toBe("'none'");
    expect(d["base-uri"]).toBe("'self'");
    expect(d["form-action"]).toBe("'self'");
  });

  it("issues a distinct policy per nonce", () => {
    expect(buildCsp("one")).not.toBe(buildCsp("two"));
  });
});

describe("buildCsp — app still works", () => {
  it("allows the API origin in connect-src", () => {
    const d = directives(buildCsp("n", { apiOrigin: "https://api.uptimeflow.in" }));
    expect(d["connect-src"]).toBe("'self' https://api.uptimeflow.in");
  });

  it("reduces a full API URL to its origin", () => {
    const d = directives(buildCsp("n", { apiOrigin: "https://api.uptimeflow.in/v1/monitors?x=1" }));
    expect(d["connect-src"]).toBe("'self' https://api.uptimeflow.in");
  });

  it("falls back to 'self' when the API URL is unset or unparseable", () => {
    expect(directives(buildCsp("n", { apiOrigin: "" }))["connect-src"]).toBe("'self'");
    expect(directives(buildCsp("n", { apiOrigin: "not a url" }))["connect-src"]).toBe("'self'");
  });

  it("allows remote branding images and inline style attributes", () => {
    const d = directives(buildCsp("n"));
    expect(d["img-src"]).toContain("https:");
    // React renders `style={{…}}` as an inline attribute (the brand accent).
    expect(d["style-src"]).toContain("'unsafe-inline'");
  });

  it("upgrades insecure requests only in production", () => {
    expect(buildCsp("n", { isProduction: true })).toContain("upgrade-insecure-requests");
    expect(buildCsp("n", { isProduction: false })).not.toContain("upgrade-insecure-requests");
  });
});

describe("originOf", () => {
  it("extracts origins and rejects junk", () => {
    expect(originOf("https://api.example.com/v1")).toBe("https://api.example.com");
    expect(originOf("http://localhost:4000")).toBe("http://localhost:4000");
    expect(originOf("nope")).toBeNull();
    expect(originOf(null)).toBeNull();
    expect(originOf(undefined)).toBeNull();
  });
});
