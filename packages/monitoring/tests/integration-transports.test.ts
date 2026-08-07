import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@backend-uptime/db";
import { redactToken, type FetchLike } from "@backend-uptime/notifications";
import {
  discordAlertTransport,
  msTeamsAlertTransport,
  telegramAlertTransport,
  toAlertEvent,
  type AlertChannelView,
  type AlertPayload,
} from "../src/index.js";

/**
 * Success + failure coverage for the three transports added alongside Slack.
 * Every test injects `fetchImpl`, so nothing here touches the network — these
 * prove payload shape, tenant scoping, and error mapping, not live delivery.
 */

const INTEGRATION_ID = "018f5a2c-0000-7000-8000-000000000002";
const ORG = "org_1";
const DISCORD_URL = "https://discord.com/api/webhooks/123/abc";
const TEAMS_URL = "https://prod-1.westus.logic.azure.com/workflows/abc/triggers/manual/paths/invoke";
const BOT_TOKEN = "123456789:AAFAKE_test_fixture_not_a_real_token";
const CHAT_ID = "-1001234567890";

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

/** Prisma stand-in exposing one integration delegate; records its where-clause. */
function mockPrisma(delegate: string, row: Record<string, unknown> | null) {
  const queries: Array<Record<string, unknown>> = [];
  const prisma = {
    [delegate]: {
      findFirst: async (args: { where: Record<string, unknown> }) => {
        queries.push(args.where);
        return row;
      },
    },
  } as unknown as PrismaClient;
  return { prisma, queries };
}

function channelOf(type: AlertChannelView["type"]): AlertChannelView {
  return {
    id: "ch_1",
    organizationId: ORG,
    type,
    name: `Ops ${type}`,
    config: { integrationId: INTEGRATION_ID },
  };
}

const payload: AlertPayload = {
  kind: "opened",
  incidentId: "inc_1",
  monitorName: "Acme API",
  title: "Acme API is down",
  severity: "MAJOR",
  summary: "connect ECONNREFUSED",
  occurredAt: "2026-08-08T10:00:00.000Z",
};

// ─── Shared event mapping ─────────────────────────────────────────────────────

describe("toAlertEvent", () => {
  it("maps opened → incident.opened / DOWN", () => {
    expect(toAlertEvent(payload, "https://app.test")).toMatchObject({
      event: "incident.opened",
      status: "DOWN",
      url: "https://app.test/dashboard/incidents/inc_1",
    });
  });

  it("maps resolved → incident.resolved / RESOLVED", () => {
    expect(toAlertEvent({ ...payload, kind: "resolved" }, "https://app.test")).toMatchObject({
      event: "incident.resolved",
      status: "RESOLVED",
    });
  });
});

// ─── Discord ──────────────────────────────────────────────────────────────────

describe("discordAlertTransport", () => {
  it("posts a Discord embed to the resolved webhook", async () => {
    const { prisma } = mockPrisma("discordIntegration", { webhookUrl: DISCORD_URL });
    const { fetchImpl, calls } = mockFetch({ status: 204 });

    const result = await discordAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("DISCORD"),
      payload,
    );

    expect(result).toEqual({ providerMessageId: null });
    expect(calls[0]!.url).toBe(DISCORD_URL);
    expect(calls[0]!.body).toMatchObject({
      embeds: [{ title: "Acme API is down", url: "https://app.test/dashboard/incidents/inc_1" }],
    });
  });

  it("scopes the integration lookup by org and excludes soft-deleted rows", async () => {
    const { prisma, queries } = mockPrisma("discordIntegration", { webhookUrl: DISCORD_URL });
    const { fetchImpl } = mockFetch({ status: 204 });
    await discordAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("DISCORD"),
      payload,
    );
    expect(queries[0]).toEqual({ id: INTEGRATION_ID, organizationId: ORG, deletedAt: null });
  });

  it("throws on non-2xx so BullMQ retries", async () => {
    const { prisma } = mockPrisma("discordIntegration", { webhookUrl: DISCORD_URL });
    const { fetchImpl } = mockFetch({ status: 401, body: "Unauthorized" });
    await expect(
      discordAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channelOf("DISCORD"), payload),
    ).rejects.toThrow(/401.*Unauthorized/);
  });

  it("throws — and sends nothing — when the integration is another org's", async () => {
    const { prisma } = mockPrisma("discordIntegration", null);
    const { fetchImpl, calls } = mockFetch({ status: 204 });
    await expect(
      discordAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
        { ...channelOf("DISCORD"), organizationId: "org_2" },
        payload,
      ),
    ).rejects.toThrow(/Discord integration .* no longer exists/i);
    expect(calls).toHaveLength(0);
  });
});

// ─── Microsoft Teams ──────────────────────────────────────────────────────────

describe("msTeamsAlertTransport", () => {
  it("posts an Adaptive Card envelope to the resolved webhook", async () => {
    const { prisma } = mockPrisma("msTeamsIntegration", { webhookUrl: TEAMS_URL });
    const { fetchImpl, calls } = mockFetch({ status: 202 });

    const result = await msTeamsAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("MICROSOFT_TEAMS"),
      payload,
    );

    expect(result).toEqual({ providerMessageId: null });
    expect(calls[0]!.url).toBe(TEAMS_URL);
    expect(calls[0]!.body).toMatchObject({
      type: "message",
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          content: { type: "AdaptiveCard" },
        },
      ],
    });
  });

  it("treats 202 Accepted (Workflows) as success", async () => {
    const { prisma } = mockPrisma("msTeamsIntegration", { webhookUrl: TEAMS_URL });
    const { fetchImpl } = mockFetch({ status: 202 });
    await expect(
      msTeamsAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
        channelOf("MICROSOFT_TEAMS"),
        payload,
      ),
    ).resolves.toEqual({ providerMessageId: null });
  });

  it("carries the incident deep link as an OpenUrl action", async () => {
    const { prisma } = mockPrisma("msTeamsIntegration", { webhookUrl: TEAMS_URL });
    const { fetchImpl, calls } = mockFetch({ status: 202 });
    await msTeamsAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("MICROSOFT_TEAMS"),
      payload,
    );
    expect(JSON.stringify(calls[0]!.body)).toContain(
      '"url":"https://app.test/dashboard/incidents/inc_1"',
    );
  });

  it("throws on non-2xx so BullMQ retries", async () => {
    const { prisma } = mockPrisma("msTeamsIntegration", { webhookUrl: TEAMS_URL });
    const { fetchImpl } = mockFetch({ status: 400, body: "Bad payload" });
    await expect(
      msTeamsAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
        channelOf("MICROSOFT_TEAMS"),
        payload,
      ),
    ).rejects.toThrow(/400.*Bad payload/);
  });
});

// ─── Telegram ─────────────────────────────────────────────────────────────────

describe("telegramAlertTransport", () => {
  it("posts sendMessage with the resolved chat id", async () => {
    const { prisma } = mockPrisma("telegramIntegration", { botToken: BOT_TOKEN, chatId: CHAT_ID });
    const { fetchImpl, calls } = mockFetch({ status: 200, body: '{"ok":true}' });

    const result = await telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("TELEGRAM"),
      payload,
    );

    expect(result).toEqual({ providerMessageId: null });
    expect(calls[0]!.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    expect(calls[0]!.body).toMatchObject({ chat_id: CHAT_ID, parse_mode: "HTML" });
  });

  it("escapes HTML in monitor-supplied text so Telegram can parse the message", async () => {
    const { prisma } = mockPrisma("telegramIntegration", { botToken: BOT_TOKEN, chatId: CHAT_ID });
    const { fetchImpl, calls } = mockFetch({ status: 200 });

    await telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("TELEGRAM"),
      { ...payload, summary: 'got <html> & "quotes"' },
    );

    const text = (calls[0]!.body as { text: string }).text;
    expect(text).toContain("&lt;html&gt; &amp; ");
    expect(text).not.toContain("<html>");
  });

  it("scopes the credential lookup by org", async () => {
    const { prisma, queries } = mockPrisma("telegramIntegration", { botToken: BOT_TOKEN, chatId: CHAT_ID });
    const { fetchImpl } = mockFetch({ status: 200 });
    await telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(
      channelOf("TELEGRAM"),
      payload,
    );
    expect(queries[0]).toEqual({ id: INTEGRATION_ID, organizationId: ORG, deletedAt: null });
  });

  it("throws on a Telegram API error so BullMQ retries", async () => {
    const { prisma } = mockPrisma("telegramIntegration", { botToken: BOT_TOKEN, chatId: CHAT_ID });
    const { fetchImpl } = mockFetch({ status: 400, body: '{"ok":false,"description":"chat not found"}' });
    await expect(
      telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channelOf("TELEGRAM"), payload),
    ).rejects.toThrow(/400.*chat not found/);
  });

  // The bot token authorizes every chat the bot is in, and it rides in the URL
  // path — so it must never survive into NotificationDelivery.lastError, which
  // is persisted and rendered in the dashboard.
  it("never leaks the bot token into the thrown error", async () => {
    const { prisma } = mockPrisma("telegramIntegration", { botToken: BOT_TOKEN, chatId: CHAT_ID });
    // Simulate a network-layer failure whose message echoes the request URL.
    const fetchImpl: FetchLike = async () => {
      throw new Error(`connect ETIMEDOUT https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
    };

    await expect(
      telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channelOf("TELEGRAM"), payload),
    ).rejects.toThrow(/«redacted»/);

    await expect(
      telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channelOf("TELEGRAM"), payload),
    ).rejects.not.toThrow(new RegExp(BOT_TOKEN.split(":")[1]!));
  });

  it("throws when the integration does not resolve", async () => {
    const { prisma } = mockPrisma("telegramIntegration", null);
    const { fetchImpl, calls } = mockFetch({ status: 200 });
    await expect(
      telegramAlertTransport({ prisma, webUrl: "https://app.test", fetchImpl })(channelOf("TELEGRAM"), payload),
    ).rejects.toThrow(/Telegram integration .* no longer exists/i);
    expect(calls).toHaveLength(0);
  });
});

// ─── Token redaction ──────────────────────────────────────────────────────────

describe("redactToken", () => {
  it("keeps the bot id but removes the secret half", () => {
    expect(redactToken(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`)).toBe(
      "https://api.telegram.org/bot123456789:«redacted»/sendMessage",
    );
  });

  it("leaves text without a token untouched", () => {
    expect(redactToken("chat not found")).toBe("chat not found");
  });
});
