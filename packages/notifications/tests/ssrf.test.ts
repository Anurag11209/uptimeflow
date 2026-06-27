import { describe, expect, it } from "vitest";
import {
  assertSafeUrl,
  createSecureLookup,
  isBlockedIp,
  isBlockedIpv4,
  isBlockedIpv6,
  parseIpv6,
  SsrfError,
  validateUrl,
} from "../src/security/ssrf.js";
import { postRaw, type FetchLike } from "../src/integrations/http.js";

const NO_PRIVATE = { allowPrivate: false } as const;

// ─── IPv4 classification ────────────────────────────────────────────────────

describe("isBlockedIpv4", () => {
  it("blocks loopback, private, link-local, CGNAT, multicast, broadcast", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "10.255.255.255",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // AWS/GCP/Azure metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255", // broadcast
    ]) {
      expect(isBlockedIpv4(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "11.0.0.1"]) {
      expect(isBlockedIpv4(ip), ip).toBe(false);
    }
  });

  it("fails closed on garbage", () => {
    expect(isBlockedIpv4("999.1.1.1")).toBe(true);
    expect(isBlockedIpv4("nope")).toBe(true);
  });
});

// ─── IPv6 classification ────────────────────────────────────────────────────

describe("parseIpv6", () => {
  it("expands compressed and embedded-v4 forms", () => {
    expect(parseIpv6("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6("::")).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIpv6("2606:4700:4700::1111")).toEqual([
      0x2606, 0x4700, 0x4700, 0, 0, 0, 0, 0x1111,
    ]);
    expect(parseIpv6("::ffff:127.0.0.1")).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
  });
  it("rejects malformed", () => {
    expect(parseIpv6("gggg::")).toBeNull();
    expect(parseIpv6("1:2:3")).toBeNull();
  });
});

describe("isBlockedIpv6", () => {
  it("blocks loopback, unspecified, ULA, link-local, multicast, mapped-private", () => {
    for (const ip of [
      "::1",
      "::",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback
      "::ffff:10.0.0.1", // IPv4-mapped private
    ]) {
      expect(isBlockedIpv6(ip), ip).toBe(true);
    }
  });
  it("allows public IPv6 (e.g. Cloudflare DNS)", () => {
    expect(isBlockedIpv6("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIpv6("2001:4860:4860::8888")).toBe(false);
  });
});

describe("isBlockedIp", () => {
  it("dispatches by family and fails closed on non-IPs", () => {
    expect(isBlockedIp("127.0.0.1")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("example.com")).toBe(true);
  });
});

// ─── URL validation ─────────────────────────────────────────────────────────

describe("validateUrl", () => {
  it("rejects non-http(s) protocols", () => {
    for (const u of ["ftp://x.com", "file:///etc/passwd", "gopher://x", "data:text/plain,hi"]) {
      expect(() => validateUrl(u, NO_PRIVATE), u).toThrow(SsrfError);
    }
  });
  it("rejects embedded credentials", () => {
    expect(() => validateUrl("http://user:pass@example.com", NO_PRIVATE)).toThrow(/credentials/);
  });
  it("rejects localhost and literal private/metadata IPs", () => {
    for (const u of [
      "http://localhost/x",
      "http://app.localhost/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://[::1]/x",
      "https://192.168.0.5/admin",
    ]) {
      expect(() => validateUrl(u, NO_PRIVATE), u).toThrow(SsrfError);
    }
  });
  it("accepts well-formed public URLs", () => {
    expect(validateUrl("https://example.com/hook", NO_PRIVATE).hostname).toBe("example.com");
    expect(validateUrl("http://8.8.8.8/", NO_PRIVATE).hostname).toBe("8.8.8.8");
  });
  it("honours allowPrivate override (self-hosted)", () => {
    expect(() => validateUrl("http://127.0.0.1/x", { allowPrivate: true })).not.toThrow();
    expect(() => validateUrl("http://localhost/x", { allowPrivate: true })).not.toThrow();
  });
});

// ─── assertSafeUrl (literal-IP paths; no real DNS) ──────────────────────────

describe("assertSafeUrl", () => {
  it("rejects literal private + metadata targets", async () => {
    await expect(assertSafeUrl("http://127.0.0.1/", NO_PRIVATE)).rejects.toThrow(SsrfError);
    await expect(
      assertSafeUrl("http://169.254.169.254/latest/meta-data/", NO_PRIVATE),
    ).rejects.toThrow(SsrfError);
    await expect(
      assertSafeUrl("http://metadata.google.internal/", NO_PRIVATE),
    ).rejects.toThrow(SsrfError);
  });
  it("accepts a literal public IP URL", async () => {
    await expect(assertSafeUrl("http://8.8.8.8/", NO_PRIVATE)).resolves.toBeInstanceOf(URL);
  });
});

// ─── Connect-time secure lookup (rebinding-proof) ───────────────────────────

function runLookup(
  host: string,
  opts: { allowPrivate?: boolean },
): Promise<{ err: NodeJS.ErrnoException | null; address: unknown }> {
  return new Promise((resolve) => {
    const lookup = createSecureLookup(opts) as unknown as (
      h: string,
      o: object,
      cb: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
    ) => void;
    lookup(host, { all: true }, (err, address) => resolve({ err, address }));
  });
}

describe("createSecureLookup", () => {
  it("rejects a private literal address at connect time", async () => {
    const { err } = await runLookup("127.0.0.1", NO_PRIVATE);
    expect(err).toBeInstanceOf(Error);
    expect((err as SsrfError).code).toBe("ssrf_blocked");
  });
  it("allows a public literal address", async () => {
    const { err, address } = await runLookup("8.8.8.8", NO_PRIVATE);
    expect(err).toBeNull();
    expect(Array.isArray(address)).toBe(true);
  });
  it("delegates without blocking when allowPrivate is set", async () => {
    const { err } = await runLookup("127.0.0.1", { allowPrivate: true });
    expect(err).toBeNull();
  });
});

// ─── Integration delivery wiring (postRaw) ──────────────────────────────────

describe("postRaw SSRF wiring", () => {
  it("blocks delivery to a private URL without calling fetch", async () => {
    let called = false;
    const fetchImpl: FetchLike = async () => {
      called = true;
      return { status: 200, ok: true, text: async () => "" };
    };
    const result = await postRaw("http://169.254.169.254/", "{}", {
      fetchImpl,
      ssrf: NO_PRIVATE,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toMatch(/blocked|ssrf|169\.254/i);
    expect(called).toBe(false);
  });

  it("allows a public delivery (guard passes through to fetch)", async () => {
    let called = false;
    const fetchImpl: FetchLike = async (_url, init) => {
      called = true;
      expect(init.redirect).toBe("error"); // redirects are rejected
      return { status: 200, ok: true, text: async () => "" };
    };
    const result = await postRaw("http://8.8.8.8/hook", "{}", {
      fetchImpl,
      ssrf: NO_PRIVATE,
    });
    expect(result.ok).toBe(true);
    expect(called).toBe(true);
  });
});
