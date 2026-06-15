import { eventStyle, type IntegrationEvent } from "../integrations/event.js";

export interface SlackMessage {
  text: string;
  attachments: Array<{
    color: string;
    blocks: unknown[];
    fallback: string;
  }>;
}

/**
 * Renders an IntegrationEvent into a Slack Incoming-Webhook payload: a colored
 * attachment with a header + context fields. `text` is the notification
 * fallback (shown in notifications and by old clients).
 */
export const SlackMessageBuilder = {
  build(event: IntegrationEvent): SlackMessage {
    const style = eventStyle(event.event);
    const headline = `${style.emoji} ${event.title}`;
    const fields: { type: "mrkdwn"; text: string }[] = [];
    if (event.status) fields.push({ type: "mrkdwn", text: `*Status:*\n${event.status}` });
    if (event.severity) fields.push({ type: "mrkdwn", text: `*Severity:*\n${event.severity}` });
    if (event.monitorName) fields.push({ type: "mrkdwn", text: `*Monitor:*\n${event.monitorName}` });
    if (event.organizationName) fields.push({ type: "mrkdwn", text: `*Org:*\n${event.organizationName}` });

    const blocks: unknown[] = [
      { type: "section", text: { type: "mrkdwn", text: `*${headline}*` } },
    ];
    if (event.summary) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: event.summary } });
    }
    if (fields.length > 0) {
      blocks.push({ type: "section", fields });
    }
    if (event.url) {
      blocks.push({
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "View details" }, url: event.url },
        ],
      });
    }
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `${style.label} · ${event.timestamp}` }],
    });

    return {
      text: headline,
      attachments: [{ color: style.slackColor, blocks, fallback: headline }],
    };
  },
};
