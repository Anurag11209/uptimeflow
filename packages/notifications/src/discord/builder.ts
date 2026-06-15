import { eventStyle, type IntegrationEvent } from "../integrations/event.js";

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline: boolean;
}

export interface DiscordMessage {
  content?: string;
  embeds: Array<{
    title: string;
    description?: string;
    color: number;
    url?: string;
    fields: DiscordEmbedField[];
    footer: { text: string };
    timestamp: string;
  }>;
}

/**
 * Renders an IntegrationEvent into a Discord webhook payload using a single
 * rich embed: colored sidebar, title, optional description and inline fields.
 */
export const DiscordMessageBuilder = {
  build(event: IntegrationEvent): DiscordMessage {
    const style = eventStyle(event.event);
    const fields: DiscordEmbedField[] = [];
    if (event.status) fields.push({ name: "Status", value: event.status, inline: true });
    if (event.severity) fields.push({ name: "Severity", value: event.severity, inline: true });
    if (event.monitorName) fields.push({ name: "Monitor", value: event.monitorName, inline: true });
    if (event.organizationName) fields.push({ name: "Organization", value: event.organizationName, inline: true });

    return {
      content: `${style.emoji} ${event.title}`,
      embeds: [
        {
          title: event.title,
          description: event.summary,
          color: style.decimal,
          url: event.url,
          fields,
          footer: { text: `UptimeFlow · ${style.label}` },
          timestamp: event.timestamp,
        },
      ],
    };
  },
};
