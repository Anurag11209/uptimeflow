import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProbeContext } from "../src/index.js";
import { snap } from "./fixtures.js";

/**
 * Minimal fake for node:https `request`/`ClientRequest`/`IncomingMessage`.
 * `responder(url)` decides what JSON (or error, or redirect) each request
 * gets, keyed by the requested URL, so one mock serves the IANA bootstrap
 * hop, any number of redirect hops, and the final registry hop.
 */
type Responder = (
  url: URL,
) =>
  | { status: number; body: unknown; headers?: Record<string, string> }
  | { error: NodeJS.ErrnoException };

let responder: Responder = () => ({ status: 404, body: null });

function fakeRequest(url: URL, _options: unknown, callback: (res: EventEmitter & { statusCode: number }) => void) {
  const req = new EventEmitter() as EventEmitter & {
    end: () => void;
    destroy: (err?: Error) => void;
    on: EventEmitter["on"];
  };
  req.end = () => {
    queueMicrotask(() => {
      const result = responder(url);
      if ("error" in result) {
        req.emit("error", result.error);
        req.emit("close");
        return;
      }
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: Record<string, string>;
        resume: () => void;
      };
      res.statusCode = result.status;
      res.headers = result.headers ?? {};
      res.resume = () => {};
      callback(res);
      queueMicrotask(() => {
        res.emit("data", Buffer.from(JSON.stringify(result.body)));
        res.emit("end");
        req.emit("close");
      });
    });
  };
  req.destroy = (err?: Error) => {
    if (err) req.emit("error", err);
    req.emit("close");
  };
  return req;
}

vi.mock("node:https", () => ({
  request: vi.fn((url: URL, options: unknown, callback: unknown) =>
    fakeRequest(url, options, callback as (res: EventEmitter & { statusCode: number }) => void),
  ),
}));

const { domainProbe, __resetDomainProbeCache } = await import("../src/probes/domain.js");

const ctx = (): ProbeContext => ({ signal: new AbortController().signal, now: new Date("2026-07-28T00:00:00Z") });

const BOOTSTRAP_BODY = {
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["dev"], ["https://rdap.nic.google/"]],
  ],
};

function mockBootstrapAnd(registryHandler: (url: URL) => { status: number; body: unknown }) {
  responder = (url) => {
    if (url.hostname === "data.iana.org") return { status: 200, body: BOOTSTRAP_BODY };
    return registryHandler(url);
  };
}

beforeEach(() => {
  __resetDomainProbeCache();
});

afterEach(() => {
  vi.clearAllMocks();
  responder = () => ({ status: 404, body: null });
});

describe("domainProbe", () => {
  it("requires a host", async () => {
    const out = await domainProbe(snap({ type: "DOMAIN", host: null }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("config");
  });

  it("reports expiry from a successful RDAP lookup", async () => {
    mockBootstrapAnd(() => ({
      status: 200,
      body: {
        events: [{ eventAction: "expiration", eventDate: "2026-12-01T00:00:00Z" }],
        status: ["client transfer prohibited"],
        entities: [
          {
            roles: ["registrar"],
            vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar"]]],
          },
        ],
      },
    }));
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.domain?.registrar).toBe("Example Registrar");
    expect(out.domain?.daysUntilExpiry).toBeGreaterThan(100);
    expect(out.domain?.statuses).toEqual(["client transfer prohibited"]);
  });

  it("reports unreachable when no TLD entry exists in the bootstrap registry", async () => {
    mockBootstrapAnd(() => ({ status: 404, body: null }));
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.zzzz" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("config");
  });

  it("reports unreachable on a 404 (no registration record) from the registry", async () => {
    mockBootstrapAnd(() => ({ status: 404, body: null }));
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("dns");
  });

  it("reports an error when RDAP data has no expiration event", async () => {
    mockBootstrapAnd(() => ({ status: 200, body: { events: [], status: [] } }));
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("error");
  });

  it("caches the bootstrap registry across calls", async () => {
    let bootstrapCalls = 0;
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        bootstrapCalls++;
        return { status: 200, body: BOOTSTRAP_BODY };
      }
      return { status: 200, body: { events: [{ eventAction: "expiration", eventDate: "2027-01-01T00:00:00Z" }] } };
    };
    await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    await domainProbe(snap({ type: "DOMAIN", host: "other.com" }), ctx());
    expect(bootstrapCalls).toBe(1);
  });

  it("resolves a compound public suffix (co.uk) via the parent TLD's bootstrap entry", async () => {
    // IANA's bootstrap only lists "uk", not "co.uk" — the probe must fall
    // back to progressively shorter suffixes to find it.
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        return {
          status: 200,
          body: { services: [[["uk"], ["https://rdap.nominet.uk/uk/"]]] },
        };
      }
      if (url.hostname === "rdap.nominet.uk") {
        return { status: 200, body: { events: [{ eventAction: "expiration", eventDate: "2027-03-01T00:00:00Z" }] } };
      }
      return { status: 404, body: null };
    };
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.co.uk" }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.domain?.expiresAt.toISOString()).toContain("2027-03-01");
  });

  it("follows a 302 redirect to the authoritative RDAP server", async () => {
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        return { status: 200, body: { services: [[["com"], ["https://rdap.org/"]]] } };
      }
      if (url.hostname === "rdap.org") {
        return { status: 302, body: null, headers: { location: "https://rdap.verisign.com/com/v1/domain/example.com" } };
      }
      if (url.hostname === "rdap.verisign.com") {
        return { status: 200, body: { events: [{ eventAction: "expiration", eventDate: "2027-06-01T00:00:00Z" }] } };
      }
      return { status: 404, body: null };
    };
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.domain?.expiresAt.toISOString()).toContain("2027-06-01");
  });

  it("gives up after too many redirects instead of looping forever", async () => {
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        return { status: 200, body: { services: [[["com"], ["https://loop.example/"]]] } };
      }
      // Always redirects to itself.
      return { status: 302, body: null, headers: { location: "https://loop.example/domain/example.com" } };
    };
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(false);
    expect(out.errorType).toBe("error");
  });

  it("falls back to the next mirror when the first RDAP server fails", async () => {
    let firstServerCalls = 0;
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        return {
          status: 200,
          body: { services: [[["com"], ["https://down.example/", "https://rdap.verisign.com/com/v1/"]]] },
        };
      }
      if (url.hostname === "down.example") {
        firstServerCalls++;
        return { error: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }) };
      }
      return { status: 200, body: { events: [{ eventAction: "expiration", eventDate: "2027-09-01T00:00:00Z" }] } };
    };
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(true);
    expect(out.domain?.expiresAt.toISOString()).toContain("2027-09-01");
    expect(firstServerCalls).toBe(1);
  });

  it("reports unreachable when every mirror fails", async () => {
    responder = (url) => {
      if (url.hostname === "data.iana.org") {
        return {
          status: 200,
          body: { services: [[["com"], ["https://down1.example/", "https://down2.example/"]]] },
        };
      }
      return { error: Object.assign(new Error("ECONNREFUSED"), { code: "ECONNREFUSED" }) };
    };
    const out = await domainProbe(snap({ type: "DOMAIN", host: "example.com" }), ctx());
    expect(out.reachable).toBe(false);
  });
});