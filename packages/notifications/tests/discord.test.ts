import { describe, expect, it } from "vitest";
import { DiscordMessageBuilder, DiscordNotifier, type FetchLike, type IntegrationEvent } from "../src/index.js";

const incident: IntegrationEvent = {
  event: "incident.opened",
  title: "Acme API is down",
  summary: "connect ECONNREFUSED",
  monitorName: "Acme API",
  status: "DOWN",
  url: "https://app.uptimeflow.dev/incidents/inc_1",
  timestamp: "2026-06-17T00:00:00Z",
};

describe("DiscordMessageBuilder", () => {
  it("builds a single rich embed with color, fields and url", () => {
    const msg = DiscordMessageBuilder.build(incident);
    expect(msg.embeds).toHaveLength(1);
    const embed = msg.embeds[0]!;
    expect(embed.title).toBe("Acme API is down");
    expect(embed.url).toBe("https://app.uptimeflow.dev/incidents/inc_1");
    expect(embed.color).toBe(parseInt("FF5C5C", 16));
    expect(embed.fields.map((f) => f.name)).toContain("Status");
    expect(embed.timestamp).toBe("2026-06-17T00:00:00Z");
  });

  it("uses the green color for resolved events", () => {
    const msg = DiscordMessageBuilder.build({ ...incident, event: "incident.resolved", status: "RESOLVED" });
    expect(msg.embeds[0]!.color).toBe(parseInt("2FD180", 16));
  });
});

describe("DiscordNotifier", () => {
  it("POSTs the embed and returns ok on 2xx", async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (_url, init) => {
      calls.push(init.body);
      return { status: 204, ok: true, text: async () => "" };
    };
    const result = await DiscordNotifier.send("https://discord.com/api/webhooks/1/abc", incident, { fetchImpl });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
    expect(calls[0]).toContain("Acme API is down");
  });

  it("returns a failure result on non-2xx", async () => {
    const fetchImpl: FetchLike = async () => ({ status: 400, ok: false, text: async () => "bad webhook" });
    const result = await DiscordNotifier.send("https://discord.com/api/webhooks/x", incident, { fetchImpl });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });
});
