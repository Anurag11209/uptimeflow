import { describe, expect, it } from "vitest";
import {
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WebhookMessageBuilder,
  WebhookNotifier,
  signPayload,
  verifySignature,
  type FetchLike,
  type IntegrationEvent,
} from "../src/index.js";

const event: IntegrationEvent = {
  event: "incident.opened",
  title: "Acme API is down",
  summary: "connect ECONNREFUSED",
  monitorName: "Acme API",
  status: "DOWN",
  url: "https://app.uptimeflow.dev/incidents/inc_1",
  timestamp: "2026-06-17T00:00:00Z",
};

const SECRET = "whsec_test_secret_value_123456";

describe("webhook signer", () => {
  it("produces a sha256= signature that round-trips through verifySignature", () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = signPayload(SECRET, "2026-06-17T00:00:00Z", body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifySignature(SECRET, "2026-06-17T00:00:00Z", body, sig)).toBe(true);
  });

  it("rejects a tampered body, timestamp, or secret", () => {
    const body = JSON.stringify({ hello: "world" });
    const sig = signPayload(SECRET, "2026-06-17T00:00:00Z", body);
    expect(verifySignature(SECRET, "2026-06-17T00:00:00Z", body + "x", sig)).toBe(false);
    expect(verifySignature(SECRET, "2026-06-17T00:00:01Z", body, sig)).toBe(false);
    expect(verifySignature("other_secret", "2026-06-17T00:00:00Z", body, sig)).toBe(false);
  });
});

describe("WebhookMessageBuilder", () => {
  it("wraps the event into a stable envelope", () => {
    const payload = WebhookMessageBuilder.build(event);
    expect(payload.event).toBe("incident.opened");
    expect(payload.timestamp).toBe("2026-06-17T00:00:00Z");
    expect(payload.data).toMatchObject({ title: "Acme API is down", status: "DOWN" });
  });
});

describe("WebhookNotifier", () => {
  it("sends the signed body with the three X-UptimeFlow-* headers", async () => {
    let captured: { headers: Record<string, string>; body: string } | null = null;
    const fetchImpl: FetchLike = async (_url, init) => {
      captured = { headers: init.headers, body: init.body };
      return { status: 200, ok: true, text: async () => "" };
    };

    const result = await WebhookNotifier.send("https://customer.example.com/hook", SECRET, event, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(captured).not.toBeNull();
    const { headers, body } = captured!;
    expect(headers[EVENT_HEADER]).toBe("incident.opened");
    expect(headers[TIMESTAMP_HEADER]).toBe("2026-06-17T00:00:00Z");
    // The signature header must verify against the exact bytes sent.
    expect(verifySignature(SECRET, headers[TIMESTAMP_HEADER]!, body, headers[SIGNATURE_HEADER]!)).toBe(true);
  });

  it("returns a failure result on a non-2xx response", async () => {
    const fetchImpl: FetchLike = async () => ({ status: 500, ok: false, text: async () => "server error" });
    const result = await WebhookNotifier.send("https://customer.example.com/hook", SECRET, event, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });
});
