import { describe, expect, it } from "vitest";
import { applyComparator, evaluateValidations } from "../src/assertions.js";
import { snap, sig } from "./fixtures.js";

describe("applyComparator", () => {
  it("handles string and numeric comparators", () => {
    expect(applyComparator("200", "EQUALS", "200")).toBe(true);
    expect(applyComparator("ok", "CONTAINS", "o")).toBe(true);
    expect(applyComparator("ok", "NOT_CONTAINS", "z")).toBe(true);
    expect(applyComparator(150, "GREATER_THAN", "100")).toBe(true);
    expect(applyComparator(80, "LESS_THAN", "100")).toBe(true);
    expect(applyComparator("abc123", "MATCHES_REGEX", "^abc")).toBe(true);
    expect(applyComparator("x", "EXISTS", "")).toBe(true);
    expect(applyComparator(undefined, "EXISTS", "")).toBe(false);
  });

  it("returns false for malformed regex instead of throwing", () => {
    expect(applyComparator("x", "MATCHES_REGEX", "(")).toBe(false);
  });
});

describe("evaluateValidations", () => {
  it("passes a clean response with no violations", () => {
    expect(evaluateValidations(snap(), sig({ statusCode: 200 }))).toEqual([]);
  });

  it("flags a status-code mismatch as an error", () => {
    const v = evaluateValidations(snap({ expectedStatus: 200 }), sig({ statusCode: 503 }));
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ code: "status_mismatch", severity: "error" });
  });

  it("validates required and forbidden keywords", () => {
    expect(evaluateValidations(snap({ keyword: "healthy" }), sig({ body: "all healthy" }))).toEqual([]);
    const missing = evaluateValidations(snap({ keyword: "healthy" }), sig({ body: "oops" }));
    expect(missing[0]).toMatchObject({ code: "keyword", severity: "error" });

    const inverted = evaluateValidations(
      snap({ keyword: "error", keywordInverted: true }),
      sig({ body: "an error occurred" }),
    );
    expect(inverted[0]).toMatchObject({ code: "keyword", severity: "error" });
  });

  it("warns on a near-expiry cert and errors on an expired one", () => {
    const expiring = evaluateValidations(snap(), sig({ cert: cert(7) }));
    expect(expiring[0]).toMatchObject({ code: "ssl_expiring", severity: "warn" });

    const expired = evaluateValidations(snap(), sig({ cert: cert(-2) }));
    expect(expired[0]).toMatchObject({ code: "ssl_expired", severity: "error" });

    expect(evaluateValidations(snap(), sig({ cert: cert(90) }))).toEqual([]);
  });

  it("evaluates custom assertions across sources", () => {
    const monitor = snap({
      expectedStatus: null,
      assertions: [
        { source: "HEADER", comparator: "EQUALS", property: "content-type", expected: "application/json" },
        { source: "BODY_JSON", comparator: "EQUALS", property: "status", expected: "ok" },
        { source: "RESPONSE_TIME", comparator: "LESS_THAN", property: null, expected: "500" },
      ],
    });
    const ok = evaluateValidations(
      monitor,
      sig({ headers: { "content-type": "application/json" }, body: '{"status":"ok"}', responseMs: 120 }),
    );
    expect(ok).toEqual([]);

    const bad = evaluateValidations(
      monitor,
      sig({ headers: { "content-type": "text/html" }, body: '{"status":"down"}', responseMs: 900 }),
    );
    // header + body fail as errors, slow response degrades (warn)
    expect(bad.filter((v) => v.severity === "error")).toHaveLength(2);
    expect(bad.filter((v) => v.severity === "warn")).toHaveLength(1);
  });
});

function cert(daysUntilExpiry: number) {
  const validTo = new Date(Date.now() + daysUntilExpiry * 86_400_000);
  return { validTo, validFrom: new Date(0), daysUntilExpiry, issuer: "Acme CA", subject: "example.com" };
}
