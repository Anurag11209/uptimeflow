import { describe, expect, it } from "vitest";
import { SlackMessageBuilder, SlackNotifier, type FetchLike, type IntegrationEvent } from "../src/index.js";

const incident: IntegrationEvent = {
  event: "incident.opened",
  title: "Acme API is down",
  summary: "connect ECONNREFUSED",
  monitorName: "Acme API",
  status: "DOWN",
  severity: "MAJOR",
  url: "https://app.uptimeflow.dev/incidents/inc_1",
  timestamp: "2026-06-17T00:00:00Z",
};

function fakeFetch(status: number, body = ""): { fetchImpl: FetchLike; calls: { url: string; body: string }[] } {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { status, ok: status >= 200 && status < 300, text: async () => body };
  };
  return { fetchImpl, calls };
}

describe("SlackMessageBuilder", () => {
  it("renders a colored attachment with headline, fields and a link", () => {
    const msg = SlackMessageBuilder.build(incident);
    expect(msg.text).toContain("Acme API is down");
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments[0]!.color).toBe("danger");
    const json = JSON.stringify(msg.attachments[0]!.blocks);
    expect(json).toContain("DOWN");
    expect(json).toContain("Acme API");
    expect(json).toContain("https://app.uptimeflow.dev/incidents/inc_1");
  });

  it("uses the good color for resolved events", () => {
    const msg = SlackMessageBuilder.build({ ...incident, event: "incident.resolved", status: "RESOLVED" });
    expect(msg.attachments[0]!.color).toBe("good");
  });
});

describe("SlackNotifier", () => {
  it("POSTs the built message and returns ok on 2xx", async () => {
    const { fetchImpl, calls } = fakeFetch(200, "ok");
    const result = await SlackNotifier.send("https://hooks.slack.com/services/T/B/X", incident, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://hooks.slack.com/services/T/B/X");
    expect(calls[0]!.body).toContain("Acme API is down");
  });

  it("returns a failure result on non-2xx without throwing", async () => {
    const { fetchImpl } = fakeFetch(404, "no_service");
    const result = await SlackNotifier.send("https://hooks.slack.com/services/x", incident, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.error).toContain("no_service");
  });

  it("maps a network error to status 0", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new Error("ENOTFOUND");
    };
    const result = await SlackNotifier.send("https://hooks.slack.com/x", incident, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.error).toContain("ENOTFOUND");
  });
});
