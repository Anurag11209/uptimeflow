import { describe, expect, it } from "vitest";
import { safeJsonLd } from "@/lib/status";

/**
 * Regression tests for the stored XSS in the public status page.
 *
 * A status page's `name`/`description` are tenant-controlled and were embedded
 * with a bare `JSON.stringify` inside `<script type="application/ld+json">`.
 * `JSON.stringify` does not escape `<`, so a name containing `</script>` closed
 * the tag and executed attacker script on a public page sharing an origin with
 * the dashboard.
 */

/** The serialized payload as the browser's HTML parser would see it. */
function embed(value: unknown): string {
  return `<script type="application/ld+json">${safeJsonLd(value)}</script>`;
}

const BREAKOUTS = [
  "</script><script>alert(1)</script>",
  "</SCRIPT ><script>alert(1)</script>",
  "</script\t><img src=x onerror=alert(1)>",
  "</script\n><svg/onload=alert(1)>",
  "</script><script>alert(1)</script>",
  "</script><!--<script>",
];

describe("safeJsonLd — script breakout", () => {
  it.each(BREAKOUTS)("neutralizes %j in the page name", (payload) => {
    const html = embed({ "@type": "WebSite", name: `${payload} Status` });

    // The one property that actually matters: nothing can close the script
    // element early, so the whole payload stays inert text.
    expect(html.toLowerCase().indexOf("</script>")).toBe(html.length - "</script>".length);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<svg");
  });

  it.each(BREAKOUTS)("neutralizes %j in the description", (payload) => {
    const html = embed({ "@type": "WebSite", description: payload });
    expect(html.toLowerCase().indexOf("</script>")).toBe(html.length - "</script>".length);
  });

  it("emits no raw angle brackets or ampersands at all", () => {
    const out = safeJsonLd({ name: "</script>", description: "a & b <tag>" });
    expect(out).not.toMatch(/[<>&]/);
  });

  it("escapes the JS line terminators U+2028 / U+2029", () => {
    // Legal inside a JSON string, but raw line terminators to a JS parser.
    const out = safeJsonLd({ name: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(JSON.parse(out).name).toBe("a\u2028b\u2029c");
  });
});

describe("safeJsonLd — value preservation", () => {
  it("round-trips to exactly the original value", () => {
    const original = {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "</script><script>alert(1)</script> Status",
      description: "Tom & Jerry <3 uptime — 99.9%",
    };
    expect(JSON.parse(safeJsonLd(original))).toEqual(original);
  });

  it("stays valid JSON for every breakout payload", () => {
    for (const payload of BREAKOUTS) {
      expect(JSON.parse(safeJsonLd({ name: payload })).name).toBe(payload);
    }
  });

  it("leaves ordinary content untouched apart from the escapes", () => {
    expect(safeJsonLd({ name: "Acme Status" })).toBe('{"name":"Acme Status"}');
  });
});
