import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProbeContext } from "../src/index.js";
import { snap } from "./fixtures.js";

const resolve4 = vi.fn();
const resolve6 = vi.fn();
const resolveCname = vi.fn();
const resolveNs = vi.fn();
const resolveMx = vi.fn();
const resolveTxt = vi.fn();
const resolveSoa = vi.fn();

vi.mock("node:dns/promises", () => ({
  Resolver: vi.fn().mockImplementation(() => ({
    resolve4,
    resolve6,
    resolveCname,
    resolveNs,
    resolveMx,
    resolveTxt,
    resolveSoa,
  })),
}));

const { dnsProbe } = await import("../src/probes/dns.js");

const ctx = (): ProbeContext => ({ signal: new AbortController().signal, now: new Date() });

function dnsErr(code: string): NodeJS.ErrnoException {
  const err = new Error(code) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("dnsProbe", () => {
  it("requires a host", async () => {
    const out = await dnsProbe(snap({ type: "DNS", host: null }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("config");
  });

  it("resolves A records by default and reports them", async () => {
    resolve4.mockResolvedValue(["93.184.216.34"]);
    const out = await dnsProbe(snap({ type: "DNS", host: "example.com" }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.dns).toEqual({ recordType: "A", values: ["93.184.216.34"] });
  });

  it("blocks a resolved private/loopback address", async () => {
    resolve4.mockResolvedValue(["127.0.0.1"]);
    const out = await dnsProbe(snap({ type: "DNS", host: "internal.example.com" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("blocked");
  });

  it("reports NXDOMAIN-style failures as unreachable with errorType dns", async () => {
    resolve4.mockRejectedValue(dnsErr("ENOTFOUND"));
    const out = await dnsProbe(snap({ type: "DNS", host: "does-not-exist.invalid" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("dns");
  });

  it("reports empty results as unreachable", async () => {
    resolve4.mockResolvedValue([]);
    const out = await dnsProbe(snap({ type: "DNS", host: "example.com" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("dns");
  });

  it("times out when the lookup hangs past the abort signal", async () => {
    resolve4.mockImplementation(() => new Promise(() => {})); // never resolves
    const controller = new AbortController();
    const promise = dnsProbe(snap({ type: "DNS", host: "example.com" }), {
      signal: controller.signal,
      now: new Date(),
    });
    controller.abort();
    const out = await promise;
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("timeout");
  });

  it("queries the record type named by a DNS_RECORD assertion", async () => {
    resolveMx.mockResolvedValue([{ priority: 10, exchange: "mail.example.com" }]);
    const out = await dnsProbe(
      snap({
        type: "DNS",
        host: "example.com",
        assertions: [{ source: "DNS_RECORD", comparator: "CONTAINS", property: "MX", expected: "mail" }],
      }),
      ctx(),
    );
    expect(out.reachable).toBe(true);
    expect(out.dns).toEqual({ recordType: "MX", values: ["10 mail.example.com"] });
    expect(resolveMx).toHaveBeenCalledWith("example.com");
  });

  it("joins multi-chunk TXT records", async () => {
    resolveTxt.mockResolvedValue([["v=spf1 ", "include:_spf.example.com ~all"]]);
    const out = await dnsProbe(
      snap({
        type: "DNS",
        host: "example.com",
        assertions: [{ source: "DNS_RECORD", comparator: "CONTAINS", property: "TXT", expected: "spf1" }],
      }),
      ctx(),
    );
    expect(out.dns?.values).toEqual(["v=spf1 include:_spf.example.com ~all"]);
  });

  it("falls back to the default record type for an unrecognized assertion property", async () => {
    resolve4.mockResolvedValue(["1.2.3.4"]);
    const out = await dnsProbe(
      snap({
        type: "DNS",
        host: "example.com",
        assertions: [{ source: "DNS_RECORD", comparator: "EXISTS", property: "BOGUS", expected: "" }],
      }),
      ctx(),
    );
    expect(out.dns?.recordType).toBe("A");
  });
});
