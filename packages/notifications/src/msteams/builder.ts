import { eventStyle, type IntegrationEvent, type IntegrationEventName } from "../integrations/event.js";

export interface MsTeamsMessage {
  type: "message";
  attachments: Array<{
    contentType: "application/vnd.microsoft.card.adaptive";
    contentUrl: null;
    content: Record<string, unknown>;
  }>;
}

/**
 * Adaptive Cards expose a fixed palette of semantic colours rather than hex, so
 * the shared EventStyle hex/decimal used by Slack and Discord doesn't apply.
 * Mapped here rather than added to EventStyle so the shared type stays
 * provider-neutral and the existing builders are untouched.
 */
const CARD_COLOR: Record<IntegrationEventName, string> = {
  "incident.opened": "Attention",
  "incident.acknowledged": "Warning",
  "incident.updated": "Warning",
  "incident.resolved": "Good",
  "maintenance.created": "Accent",
  "maintenance.updated": "Accent",
  test: "Default",
};

/**
 * Renders an IntegrationEvent as an Adaptive Card wrapped in the message
 * envelope that Teams **Workflows** (Power Automate) expects.
 *
 * This targets Workflows rather than the older Office 365 connector
 * `MessageCard` format: Microsoft has retired connector webhooks, and the
 * `contentType: application/vnd.microsoft.card.adaptive` envelope is what the
 * "When a Teams webhook request is received" trigger accepts. Legacy connector
 * URLs still accept this shape, so tenants mid-migration keep working.
 */
export const MsTeamsMessageBuilder = {
  build(event: IntegrationEvent): MsTeamsMessage {
    const style = eventStyle(event.event);

    const body: Array<Record<string, unknown>> = [
      {
        type: "TextBlock",
        text: `${style.emoji} ${event.title}`,
        weight: "Bolder",
        size: "Medium",
        wrap: true,
        color: CARD_COLOR[event.event] ?? "Default",
      },
    ];

    if (event.summary) {
      body.push({ type: "TextBlock", text: event.summary, wrap: true, spacing: "Small" });
    }

    const facts: Array<{ title: string; value: string }> = [];
    if (event.status) facts.push({ title: "Status", value: event.status });
    if (event.severity) facts.push({ title: "Severity", value: event.severity });
    if (event.monitorName) facts.push({ title: "Monitor", value: event.monitorName });
    if (event.organizationName) facts.push({ title: "Organization", value: event.organizationName });
    if (facts.length > 0) body.push({ type: "FactSet", facts });

    body.push({
      type: "TextBlock",
      text: `${style.label} · ${event.timestamp}`,
      wrap: true,
      isSubtle: true,
      size: "Small",
      spacing: "Small",
    });

    const content: Record<string, unknown> = {
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      type: "AdaptiveCard",
      version: "1.4",
      body,
    };
    if (event.url) {
      content.actions = [{ type: "Action.OpenUrl", title: "View details", url: event.url }];
    }

    return {
      type: "message",
      attachments: [
        { contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content },
      ],
    };
  },
};
