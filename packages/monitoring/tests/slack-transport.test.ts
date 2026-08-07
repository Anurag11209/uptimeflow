import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import type { FetchLike } from "@backend-uptime/notifications";
import {
  parseSlackChannelConfig,
  resolveSlackWebhookUrl,
  slackAlertTransport,
  toSlackAlertEvent,
  type AlertChannelView,
  type AlertPayload,
} from "../src/index.js";

const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/xxxx";
const INTEGRATION_ID = "018f5a2c-0000-7000-8000-000000000001";
const ORG = "org_1";

/** Prisma stand-in that records the slackIntegration lookup it was given. */
function mockPrisma(integration: { webhookUrl: string } | null) {
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    slackIntegration: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        queries.push(args.where);
        return integration;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, queries };
}

/** Captures the outbound request and replies with a canned response. */
function mockFetch(response: { status: number; body?: string }) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) as unknown });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => response.body ?? "",
    };
  };
  return { fetchImpl, calls };
}

const channel: AlertChannelView = {
  id: "ch_1",
  organizationId: ORG,
  type: "SLACK",
  name: "Ops Slack",
  config: { integrationId: INTEGRATION_ID },
};

const payload: AlertPayload = {
  kind: "opened",
  incidentId: "inc_1",
  monitorName: "Acme API",
  title: "Acme API is down",
  severity: "MAJOR",
  summary: "connect ECONNREFUSED",
  occurredAt: "2026-08-08T10:00:00.000Z",
};

// ─── parseSlackChannelConfig ──────────────────────────────────────────────────

describe("parseSlackChannelConfig", () => {
  it("accepts a well-formed integrationId", () => {
    expect(parseSlackChannelConfig({ integrationId: INTEGRATION_ID })).toEqual({
      integrationId: INTEGRATION_ID,
    });
  });

  it.each([
    ["missing key", {}],
    ["null config", null],
    ["undefined config", undefined],
    ["empty string", { integrationId: "" }],
    ["non-string", { integrationId: 42 }],
    ["a webhook url instead of an id", { webhookUrl: WEBHOOK_URL }],
  ])("rejects %s", (_label, config) => {
    expect(() => parseSlackChannelConfig(config)).toThrow(/integrationId/i);
  });

  it("rejects a non-uuid id rather than letting Prisma raise a raw type error", () => {
    expect(() => parseSlackChannelConfig({ integrationId: "not-a-uuid" })).toThrow(/not a valid id/i);
  });
});

// ─── resolveSlackWebhookUrl ───────────────────────────────────────────────────

describe("resolveSlackWebhookUrl", () => {
  it("returns the integration's webhook url", async () => {
    const { prisma } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    await expect(resolveSlackWebhookUrl(prisma, ORG, channel.config)).resolves.toBe(WEBHOOK_URL);
  });

  it("scopes the lookup by organization and excludes soft-deleted rows", async () => {
    const { prisma, queries } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    await resolveSlackWebhookUrl(prisma, ORG, channel.config);
    // Tenant isolation: the id comes from tenant-supplied config, so an
    // unscoped lookup would let one org address another org's workspace.
    expect(queries[0]).toEqual({ id: INTEGRATION_ID, organizationId: ORG, deletedAt: null });
  });

  it("throws when the integration does not resolve (unknown, other org, or deleted)", async () => {
    const { prisma } = mockPrisma(null);
    await expect(resolveSlackWebhookUrl(prisma, ORG, channel.config)).rejects.toThrow(
      /no longer exists/i,
    );
  });
});

// ─── toSlackAlertEvent ────────────────────────────────────────────────────────

describe("toSlackAlertEvent", () => {
  it("maps an opened alert to incident.opened / DOWN", () => {
    const event = toSlackAlertEvent(payload, "https://app.test");
    expect(event).toMatchObject({
      event: "incident.opened",
      status: "DOWN",
      title: "Acme API is down",
      monitorName: "Acme API",
      severity: "MAJOR",
      summary: "connect ECONNREFUSED",
      timestamp: "2026-08-08T10:00:00.000Z",
    });
  });

  it("maps a resolved alert to incident.resolved / RESOLVED", () => {
    const event = toSlackAlertEvent({ ...payload, kind: "resolved" }, "https://app.test");
    expect(event).toMatchObject({ event: "incident.resolved", status: "RESOLVED" });
  });

  it("builds an incident deep link", () => {
    expect(toSlackAlertEvent(payload, "https://app.test").url).toBe(
      "https://app.test/incidents/inc_1",
    );
  });

  it("normalizes null severity/summary to undefined so they are omitted", () => {
    const event = toSlackAlertEvent({ ...payload, severity: null, summary: null }, "https://app.test");
    expect(event.severity).toBeUndefined();
    expect(event.summary).toBeUndefined();
  });
});

// ─── slackAlertTransport ──────────────────────────────────────────────────────

describe("slackAlertTransport", () => {
  it("posts a built Slack message to the resolved webhook url", async () => {
    const { prisma } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    const { fetchImpl, calls } = mockFetch({ status: 200, body: "ok" });

    const result = await slackAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channel,
      payload,
    );

    expect(result).toEqual({ providerMessageId: null });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(WEBHOOK_URL);
    // Rendered by the shared SlackMessageBuilder — same shape the org-level
    // Integrations path produces.
    expect(calls[0]!.body).toMatchObject({
      text: expect.stringContaining("Acme API is down"),
      attachments: [{ color: "danger" }],
    });
  });

  it("trims a trailing slash from webUrl when building the deep link", async () => {
    const { prisma } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    const { fetchImpl, calls } = mockFetch({ status: 200 });

    await slackAlertTransport({ prisma, webUrl: "https://app.test/", fetchImpl })(channel, payload);

    const body = calls[0]!.body as { attachments: Array<{ blocks: unknown[] }> };
    expect(JSON.stringify(body.attachments[0]!.blocks)).toContain("https://app.test/incidents/inc_1");
  });

  it("throws on a non-2xx from Slack so BullMQ retries", async () => {
    const { prisma } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    const { fetchImpl } = mockFetch({ status: 404, body: "no_service" });

    await expect(
      slackAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channel, payload),
    ).rejects.toThrow(/404.*no_service/);
  });

  it("throws when the channel config has no integrationId", async () => {
    const { prisma } = mockPrisma({ webhookUrl: WEBHOOK_URL });
    const { fetchImpl } = mockFetch({ status: 200 });

    await expect(
      slackAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
        { ...channel, config: {} },
        payload,
      ),
    ).rejects.toThrow(/integrationId/i);
  });

  it("throws — and sends nothing — when the integration belongs to another org", async () => {
    const { prisma, queries } = mockPrisma(null); // scoped lookup finds nothing
    const { fetchImpl, calls } = mockFetch({ status: 200 });

    await expect(
      slackAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
        { ...channel, organizationId: "org_2" },
        payload,
      ),
    ).rejects.toThrow(/no longer exists/i);

    expect(queries[0]).toMatchObject({ organizationId: "org_2" });
    expect(calls).toHaveLength(0);
  });
});
