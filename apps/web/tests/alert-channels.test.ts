import { describe, expect, it } from "vitest";
import {
  buildConfig,
  channelStatusMeta,
  configKeyFor,
  formatChannelType,
  isIntegrationBacked,
  primaryConfigValue,
  STUB_TRANSPORT_TYPES,
  type AlertChannelItem,
  type AlertChannelType,
} from "../lib/alert-channels";

// ─── Factory ──────────────────────────────────────────────────────────────────

function makeChannel(partial: Partial<AlertChannelItem> = {}): AlertChannelItem {
  return {
    id: "ch-1",
    type: "EMAIL",
    name: "Test Channel",
    config: { email: "devops@example.com" },
    enabled: true,
    verifiedAt: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    ...partial,
  };
}

// ─── formatChannelType ────────────────────────────────────────────────────────

describe("formatChannelType", () => {
  it("formats every known type", () => {
    const cases: [AlertChannelType, string][] = [
      ["EMAIL", "Email"],
      ["SMS", "SMS"],
      ["VOICE", "Voice"],
      ["SLACK", "Slack"],
      ["DISCORD", "Discord"],
      ["TELEGRAM", "Telegram"],
      ["MICROSOFT_TEAMS", "Microsoft Teams"],
      ["WEBHOOK", "Webhook"],
      ["PAGERDUTY", "PagerDuty"],
      ["OPSGENIE", "OpsGenie"],
    ];
    for (const [type, label] of cases) {
      expect(formatChannelType(type)).toBe(label);
    }
  });
});

// ─── channelStatusMeta ────────────────────────────────────────────────────────

describe("channelStatusMeta", () => {
  it("returns up/Active for enabled channels", () => {
    const meta = channelStatusMeta(true);
    expect(meta.label).toBe("Active");
    expect(meta.tone).toBe("up");
  });

  it("returns muted/Disabled for disabled channels", () => {
    const meta = channelStatusMeta(false);
    expect(meta.label).toBe("Disabled");
    expect(meta.tone).toBe("muted");
  });
});

// ─── configKeyFor ─────────────────────────────────────────────────────────────

describe("configKeyFor", () => {
  it("returns email for EMAIL", () => {
    expect(configKeyFor("EMAIL")).toBe("email");
  });

  it("returns phoneNumber for SMS", () => {
    expect(configKeyFor("SMS")).toBe("phoneNumber");
  });

  it("returns phoneNumber for VOICE", () => {
    expect(configKeyFor("VOICE")).toBe("phoneNumber");
  });

  it("returns integrationId for integration-backed types", () => {
    for (const type of [
      "SLACK",
      "DISCORD",
      "WEBHOOK",
      "PAGERDUTY",
      "OPSGENIE",
    ] as AlertChannelType[]) {
      expect(configKeyFor(type)).toBe("integrationId");
    }
  });
});

// ─── buildConfig ──────────────────────────────────────────────────────────────

describe("buildConfig", () => {
  it("builds email config", () => {
    expect(buildConfig("EMAIL", "devops@example.com")).toEqual({
      email: "devops@example.com",
    });
  });

  it("builds phoneNumber config for SMS", () => {
    expect(buildConfig("SMS", "+1234567890")).toEqual({
      phoneNumber: "+1234567890",
    });
  });

  it("builds phoneNumber config for VOICE", () => {
    expect(buildConfig("VOICE", "+1234567890")).toEqual({
      phoneNumber: "+1234567890",
    });
  });

  it("builds integrationId config for Slack", () => {
    expect(buildConfig("SLACK", "int-abc123")).toEqual({
      integrationId: "int-abc123",
    });
  });

  it("builds integrationId config for Webhook", () => {
    expect(buildConfig("WEBHOOK", "int-xyz789")).toEqual({
      integrationId: "int-xyz789",
    });
  });
});

// ─── primaryConfigValue ───────────────────────────────────────────────────────

describe("primaryConfigValue", () => {
  it("reads email from an EMAIL channel", () => {
    const channel = makeChannel({ type: "EMAIL", config: { email: "devops@example.com" } });
    expect(primaryConfigValue(channel)).toBe("devops@example.com");
  });

  it("reads phoneNumber from an SMS channel", () => {
    const channel = makeChannel({ type: "SMS", config: { phoneNumber: "+1234567890" } });
    expect(primaryConfigValue(channel)).toBe("+1234567890");
  });

  it("reads integrationId from a SLACK channel", () => {
    const channel = makeChannel({ type: "SLACK", config: { integrationId: "int-abc" } });
    expect(primaryConfigValue(channel)).toBe("int-abc");
  });

  it("returns empty string when key is missing", () => {
    const channel = makeChannel({ type: "EMAIL", config: {} });
    expect(primaryConfigValue(channel)).toBe("");
  });
});

// ─── isIntegrationBacked ─────────────────────────────────────────────────────

describe("isIntegrationBacked", () => {
  it("returns true for SLACK, DISCORD, WEBHOOK", () => {
    expect(isIntegrationBacked("SLACK")).toBe(true);
    expect(isIntegrationBacked("DISCORD")).toBe(true);
    expect(isIntegrationBacked("WEBHOOK")).toBe(true);
  });

  it("returns false for EMAIL, SMS, VOICE", () => {
    expect(isIntegrationBacked("EMAIL")).toBe(false);
    expect(isIntegrationBacked("SMS")).toBe(false);
    expect(isIntegrationBacked("VOICE")).toBe(false);
  });
});

// ─── STUB_TRANSPORT_TYPES ─────────────────────────────────────────────────────

describe("STUB_TRANSPORT_TYPES", () => {
  it("does not include WEBHOOK (the only real transport)", () => {
    expect(STUB_TRANSPORT_TYPES).not.toContain("WEBHOOK");
  });

  it("includes EMAIL (stub)", () => {
    expect(STUB_TRANSPORT_TYPES).toContain("EMAIL");
  });

  it("includes TELEGRAM (stub)", () => {
    expect(STUB_TRANSPORT_TYPES).toContain("TELEGRAM");
  });
});
