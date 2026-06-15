import { describe, expect, it } from "vitest";
import { slugify } from "../lib/slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Acme Status")).toBe("acme-status");
  });

  it("collapses repeated separators", () => {
    expect(slugify("a  --  b")).toBe("a-b");
  });

  it("strips diacritics and symbols", () => {
    expect(slugify("Café Ops! (prod)")).toBe("cafe-ops-prod");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("caps length at 48 without trailing hyphen", () => {
    const out = slugify("x".repeat(60) + " tail");
    expect(out.length).toBeLessThanOrEqual(48);
    expect(out.endsWith("-")).toBe(false);
  });

  it("returns empty string for symbol-only input", () => {
    expect(slugify("!!!")).toBe("");
  });
});
