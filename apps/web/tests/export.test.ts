import { describe, expect, it } from "vitest";
import { csvField, toCsv } from "../lib/export";

describe("csvField", () => {
  it("passes simple values through", () => {
    expect(csvField("ok")).toBe("ok");
    expect(csvField(42)).toBe("42");
    expect(csvField(true)).toBe("true");
  });

  it("renders null/undefined as empty", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and escapes fields with commas, quotes, or newlines", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("toCsv", () => {
  it("derives columns from the rows in first-seen order", () => {
    const csv = toCsv([
      { monitor: "API", uptimePct: 99.9 },
      { monitor: "Web", uptimePct: 100 },
    ]);
    expect(csv).toBe("monitor,uptimePct\nAPI,99.9\nWeb,100");
  });

  it("honors an explicit column order and missing keys", () => {
    const csv = toCsv([{ a: 1, b: 2 }], ["b", "a", "c"]);
    expect(csv).toBe("b,a,c\n2,1,");
  });

  it("emits just the header for an empty row set", () => {
    expect(toCsv([], ["a", "b"])).toBe("a,b");
  });
});
