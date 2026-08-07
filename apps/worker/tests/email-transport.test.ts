import { describe, expect, it } from "vitest";
import type { AlertChannelView, AlertPayload } from "@backend-uptime/monitoring";
import type { EmailSender, OutboundEmail } from "@backend-uptime/notifications";
import { emailAlertTransport } from "../src/email-transport.js";

/**
 * Regression cover for the phantom-success bug: the EMAIL transport used to run
 * on the SES-or-logging `EmailProvider`, so any EMAIL_PROVIDER other than "ses"
 * returned a synthetic message id that the alert processor recorded as
 * DELIVERED. It now runs on the `EmailSender` (ses | resend | smtp), which has
 * no logging branch at all — so there is no configuration in any environment
 * that produces a fake success.
 */

function mockSender(behaviour: { messageId?: string | null; throws?: Error } = {}) {
  const sent: OutboundEmail[] = [];
  const sender: EmailSender = {
    async send(email) {
      sent.push(email);
      if (behaviour.throws) throw behaviour.throws;
      return { providerMessageId: behaviour.messageId ?? "smtp-1" };
    },
  };
  return { sender, sent };
}

const channel: AlertChannelView = {
  id: "ch_1",
  organizationId: "org_1",
  type: "EMAIL",
  name: "Ops Email",
  config: { recipients: ["ops@example.com", "sre@example.com"] },
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

describe("emailAlertTransport", () => {
  it("sends through the EmailSender and returns the real provider message id", async () => {
    const { sender, sent } = mockSender({ messageId: "smtp-abc" });

    const result = await emailAlertTransport(sender, "https://app.test")(channel, payload);

    expect(result).toEqual({ providerMessageId: "smtp-abc" });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.subject).toContain("Acme API is down");
  });

  it("passes every recipient through as an array", async () => {
    const { sender, sent } = mockSender();
    await emailAlertTransport(sender, "https://app.test")(channel, payload);
    expect(sent[0]!.to).toEqual(["ops@example.com", "sre@example.com"]);
  });

  it("accepts the single-address config shape", async () => {
    const { sender, sent } = mockSender();
    await emailAlertTransport(sender, "https://app.test")(
      { ...channel, config: { email: "solo@example.com" } },
      payload,
    );
    expect(sent[0]!.to).toEqual(["solo@example.com"]);
  });

  it("links to the dashboard incident route, not a bare /incidents path", async () => {
    const { sender, sent } = mockSender();
    await emailAlertTransport(sender, "https://app.test/")(channel, payload);
    expect(sent[0]!.text).toContain("https://app.test/dashboard/incidents/inc_1");
    expect(sent[0]!.text).not.toContain("app.test/incidents/inc_1");
  });

  // The processor turns a throw into FAILED + the real error, and writes no
  // NOTIFICATION_SENT event — which is the whole point of routing through a
  // sender that can actually fail rather than one that always "succeeds".
  it("propagates a provider failure instead of reporting success", async () => {
    const { sender } = mockSender({ throws: new Error("connect ECONNREFUSED 127.0.0.1:1025") });

    await expect(
      emailAlertTransport(sender, "https://app.test")(channel, payload),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("refuses a channel with no recipients rather than sending nowhere", async () => {
    const { sender, sent } = mockSender();

    await expect(
      emailAlertTransport(sender, "https://app.test")({ ...channel, config: {} }, payload),
    ).rejects.toThrow(/missing email\/recipients/i);
    expect(sent).toHaveLength(0);
  });

  it("renders the resolved kind for a recovery alert", async () => {
    const { sender, sent } = mockSender();
    await emailAlertTransport(sender, "https://app.test")(
      channel,
      { ...payload, summary: null, kind: "resolved" },
    );
    expect(sent[0]!.text).toContain("resolved");
  });
});
