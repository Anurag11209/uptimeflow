import { eventStyle, type IntegrationEvent } from "../integrations/event.js";

export interface TelegramMessage {
  chat_id: string;
  text: string;
  parse_mode: "HTML";
  /** Link previews turn an incident link into a large unwanted card. */
  disable_web_page_preview: true;
}

/**
 * Telegram's HTML parse mode accepts a small tag whitelist and rejects the
 * whole message with 400 "can't parse entities" if any stray `<`, `>` or `&`
 * appears in the text. Every interpolated value is user- or monitor-supplied,
 * so all of it is escaped.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Renders an IntegrationEvent into a Telegram `sendMessage` payload. Telegram
 * has no attachment/embed concept like Slack or Discord, so the colour accent
 * degrades to the style emoji and the layout is a plain HTML block.
 */
export const TelegramMessageBuilder = {
  build(chatId: string, event: IntegrationEvent): TelegramMessage {
    const style = eventStyle(event.event);
    const lines: string[] = [`${style.emoji} <b>${escapeHtml(event.title)}</b>`];

    if (event.summary) lines.push("", escapeHtml(event.summary));

    const facts: string[] = [];
    if (event.status) facts.push(`<b>Status:</b> ${escapeHtml(event.status)}`);
    if (event.severity) facts.push(`<b>Severity:</b> ${escapeHtml(event.severity)}`);
    if (event.monitorName) facts.push(`<b>Monitor:</b> ${escapeHtml(event.monitorName)}`);
    if (event.organizationName) facts.push(`<b>Org:</b> ${escapeHtml(event.organizationName)}`);
    if (facts.length > 0) lines.push("", ...facts);

    if (event.url) lines.push("", `<a href="${escapeHtml(event.url)}">View details</a>`);
    lines.push("", `<i>${escapeHtml(style.label)} · ${escapeHtml(event.timestamp)}</i>`);

    return {
      chat_id: chatId,
      text: lines.join("\n"),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
  },
};
