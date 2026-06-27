import { describe, expect, it } from "vitest";
import {
  buildMonitorPayload,
  defaultMonitorForm,
  isFormValid,
  parseHeaders,
  serializeHeaders,
  typeNeedsHost,
  typeNeedsPort,
  typeNeedsUrl,
  validateMonitorForm,
  type MonitorFormState,
} from "../lib/monitor-form";

function form(overrides: Partial<MonitorFormState> = {}): MonitorFormState {
  return { ...defaultMonitorForm(), ...overrides };
}

describe("field visibility", () => {
  it("requires url for http/keyword/ssl", () => {
    expect(typeNeedsUrl("HTTP")).toBe(true);
    expect(typeNeedsUrl("KEYWORD")).toBe(true);
    expect(typeNeedsUrl("SSL")).toBe(true);
    expect(typeNeedsUrl("TCP")).toBe(false);
  });
  it("requires host for tcp/port/ping and port for tcp/port", () => {
    expect(typeNeedsHost("PING")).toBe(true);
    expect(typeNeedsPort("PING")).toBe(false);
    expect(typeNeedsPort("TCP")).toBe(true);
  });
});

describe("parseHeaders / serializeHeaders", () => {
  it("parses Key: Value lines", () => {
    expect(parseHeaders("A: 1\nB: two")).toEqual({
      headers: { A: "1", B: "two" },
    });
  });
  it("ignores blank lines and returns undefined when empty", () => {
    expect(parseHeaders("   ")).toEqual({ headers: undefined });
    expect(parseHeaders("\n\n")).toEqual({ headers: undefined });
  });
  it("reports a malformed line", () => {
    expect(parseHeaders("no-colon").error).toMatch(/Invalid header/);
  });
  it("round-trips with serializeHeaders", () => {
    expect(serializeHeaders({ A: "1", B: "2" })).toBe("A: 1\nB: 2");
    expect(serializeHeaders(null)).toBe("");
  });
});

describe("validateMonitorForm", () => {
  it("passes a valid HTTP monitor", () => {
    const errors = validateMonitorForm(
      form({ name: "API", type: "HTTP", url: "https://x.com" }),
    );
    expect(isFormValid(errors)).toBe(true);
  });

  it("requires a name", () => {
    expect(validateMonitorForm(form({ name: "  " })).name).toBeDefined();
  });

  it("requires a valid url for HTTP", () => {
    expect(validateMonitorForm(form({ type: "HTTP", url: "" })).url).toBeDefined();
    expect(
      validateMonitorForm(form({ name: "x", type: "HTTP", url: "ftp://x" })).url,
    ).toBeDefined();
  });

  it("requires host and port for TCP", () => {
    const errors = validateMonitorForm(
      form({ name: "db", type: "TCP", host: "", port: "" }),
    );
    expect(errors.host).toBeDefined();
    expect(errors.port).toBeDefined();
  });

  it("rejects an out-of-range port", () => {
    expect(
      validateMonitorForm(form({ name: "db", type: "TCP", host: "h", port: "70000" }))
        .port,
    ).toBeDefined();
  });

  it("requires a keyword for keyword monitors", () => {
    expect(
      validateMonitorForm(
        form({ name: "k", type: "KEYWORD", url: "https://x.com", keyword: "" }),
      ).keyword,
    ).toBeDefined();
  });

  it("validates numeric ranges", () => {
    const errors = validateMonitorForm(
      form({
        name: "x",
        type: "HTTP",
        url: "https://x.com",
        intervalSeconds: "5",
        timeoutSeconds: "0",
        retries: "9",
        failureThreshold: "0",
        successThreshold: "20",
      }),
    );
    expect(errors.intervalSeconds).toBeDefined();
    expect(errors.timeoutSeconds).toBeDefined();
    expect(errors.retries).toBeDefined();
    expect(errors.failureThreshold).toBeDefined();
    expect(errors.successThreshold).toBeDefined();
  });

  it("skips timeout/retries validation for heartbeat", () => {
    const errors = validateMonitorForm(
      form({ name: "hb", type: "HEARTBEAT", timeoutSeconds: "999", retries: "99" }),
    );
    expect(errors.timeoutSeconds).toBeUndefined();
    expect(errors.retries).toBeUndefined();
  });
});

describe("buildMonitorPayload", () => {
  it("only includes url for url-type monitors", () => {
    const payload = buildMonitorPayload(
      form({
        name: "API",
        type: "HTTP",
        url: "https://x.com",
        httpMethod: "POST",
        expectedStatus: "201",
        requestHeaders: "Authorization: Bearer t",
      }),
    );
    expect(payload.url).toBe("https://x.com");
    expect(payload.host).toBeUndefined();
    expect(payload.httpMethod).toBe("POST");
    expect(payload.expectedStatus).toBe(201);
    expect(payload.requestHeaders).toEqual({ Authorization: "Bearer t" });
    expect(payload.timeoutSeconds).toBe(30);
  });

  it("sends host + port for TCP and no http fields", () => {
    const payload = buildMonitorPayload(
      form({ name: "db", type: "TCP", host: "db.x", port: "5432" }),
    );
    expect(payload.host).toBe("db.x");
    expect(payload.port).toBe(5432);
    expect(payload.url).toBeUndefined();
    expect(payload.httpMethod).toBeUndefined();
  });

  it("omits probe fields for heartbeat and includes interval", () => {
    const payload = buildMonitorPayload(
      form({ name: "hb", type: "HEARTBEAT", intervalSeconds: "300" }),
    );
    expect(payload.timeoutSeconds).toBeUndefined();
    expect(payload.retries).toBeUndefined();
    expect(payload.regions).toBeUndefined();
    expect(payload.intervalSeconds).toBe(300);
  });

  it("includes keyword fields and escalation policy when set", () => {
    const payload = buildMonitorPayload(
      form({
        name: "k",
        type: "KEYWORD",
        url: "https://x.com",
        keyword: "hello",
        keywordInverted: true,
        escalationPolicyId: "pol-1",
        regions: ["EU_WEST"],
      }),
    );
    expect(payload.keyword).toBe("hello");
    expect(payload.keywordInverted).toBe(true);
    expect(payload.escalationPolicyId).toBe("pol-1");
    expect(payload.regions).toEqual(["EU_WEST"]);
  });
});
