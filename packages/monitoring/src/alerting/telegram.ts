import type { PrismaClient } from "@backend-uptime/db";
import { TelegramNotifier, redactToken, type FetchLike } from "@backend-uptime/notifications";
import type { AlertTransport } from "./transports.js";
import { resolveIntegration, toAlertEvent, type IntegrationFinder } from "./integration-channel.js";

/**
 * TELEGRAM alert-channel transport. Config is `{ integrationId }` pointing at a
 * TelegramIntegration holding the bot token and target chat id.
 *
 * The bot token is the most sensitive credential in this set: it authorizes
 * posting to (and reading from) every chat the bot belongs to, and it travels
 * in the request path. Every error string leaving this transport is passed
 * through `redactToken` — the notifier already scrubs what it returns, and this
 * is the second layer, because a thrown message ends up in
 * `NotificationDelivery.lastError`, which is stored and shown in the UI.
 */

export interface TelegramCredentials {
  botToken: string;
  chatId: string;
}

const SELECT = { botToken: true, chatId: true } as const;

export interface TelegramAlertTransportDeps {
  prisma: PrismaClient;
  /** Public app origin used to build the incident deep link. */
  webUrl: string;
  /** Injected in tests; defaults to the notifier's own hardened HTTP path. */
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

export function resolveTelegramCredentials(
  prisma: PrismaClient,
  organizationId: string,
  config: unknown,
): Promise<TelegramCredentials> {
  return resolveIntegration<TelegramCredentials>(
    prisma.telegramIntegration as unknown as IntegrationFinder<TelegramCredentials>,
    organizationId,
    config,
    SELECT,
    "Telegram",
  );
}

export function telegramAlertTransport(deps: TelegramAlertTransportDeps): AlertTransport {
  const webUrl = deps.webUrl.replace(/\/$/, "");

  return async (channel, payload) => {
    const { botToken, chatId } = await resolveTelegramCredentials(
      deps.prisma,
      channel.organizationId,
      channel.config,
    );
    const result = await TelegramNotifier.send(botToken, chatId, toAlertEvent(payload, webUrl), {
      fetchImpl: deps.fetchImpl,
      timeoutMs: deps.timeoutMs,
    });

    if (!result.ok) {
      throw new Error(
        redactToken(`Telegram API responded ${result.status}: ${result.error ?? "unknown error"}`),
      );
    }
    // sendMessage returns the created message, but capturing message_id would
    // mean parsing a body postJson deliberately does not surface.
    return { providerMessageId: null };
  };
}
