import type { IntegrationEvent } from "../integrations/event.js";
import { postJson, type DeliveryResult, type FetchLike } from "../integrations/http.js";
import { TelegramMessageBuilder } from "./builder.js";

export interface TelegramNotifierOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const TELEGRAM_API = "https://api.telegram.org";

/**
 * Telegram puts the bot token in the request *path*
 * (`/bot<TOKEN>/sendMessage`), unlike every other provider here where the
 * secret is a whole opaque webhook URL. That makes accidental disclosure much
 * easier: any code that echoes a request URL — a log line, an error string, a
 * stored debug field — leaks a credential that can post to, and read from,
 * every chat the bot belongs to.
 *
 * `redactToken` is the backstop. `postJson` only ever returns a status and the
 * *response* body, so a token cannot reach a DeliveryResult through the normal
 * path, but network-layer errors are formatted by Node and are not under our
 * control, so every outgoing error string is scrubbed regardless.
 */
export function redactToken(text: string): string {
  // bot<digits>:<secret> — replace the secret half, keep the bot id for support.
  return text.replace(/\bbot(\d+):[A-Za-z0-9_-]+/g, "bot$1:«redacted»");
}

export const TelegramNotifier = {
  async send(
    botToken: string,
    chatId: string,
    event: IntegrationEvent,
    options: TelegramNotifierOptions = {},
  ): Promise<DeliveryResult> {
    const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
    const result = await postJson(url, TelegramMessageBuilder.build(chatId, event), {
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
    });
    return result.error ? { ...result, error: redactToken(result.error) } : result;
  },
};
