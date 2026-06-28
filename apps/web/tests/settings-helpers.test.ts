import { describe, expect, it } from "vitest";
import {
  ALL_SCOPE_STRINGS,
  apiKeyStatus,
  apiKeyStatusMeta,
  expiryFromPreset,
  SCOPE_GROUPS,
} from "../lib/api-keys";
import {
  actionLabel,
  actorTypeLabel,
  auditCsvRows,
  auditResult,
  type AuditLogRow,
} from "../lib/audit-logs";
import { deviceLabel } from "../lib/sessions";
import { defaultProfilePrefs, normalizeProfilePrefs } from "../lib/profile-prefs";

const NOW = new Date("2026-06-28T00:00:00Z").getTime();

// ── API keys ─────────────────────────────────────────────────────────────────

describe("apiKeyStatus", () => {
  it("flags revoked keys first", () => {
    expect(apiKeyStatus({ revokedAt: "2026-01-01T00:00:00Z", expiresAt: null }, NOW)).toBe("revoked");
  });
  it("flags past-expiry keys as expired", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: "2026-01-01T00:00:00Z" }, NOW)).toBe("expired");
  });
  it("treats a future expiry as active", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: "2027-01-01T00:00:00Z" }, NOW)).toBe("active");
  });
  it("treats no expiry as active", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, NOW)).toBe("active");
  });
  it("maps status to tone", () => {
    expect(apiKeyStatusMeta("active").tone).toBe("up");
    expect(apiKeyStatusMeta("revoked").tone).toBe("down");
  });
});

describe("expiryFromPreset", () => {
  it("returns undefined for never", () => {
    expect(expiryFromPreset("never", NOW)).toBeUndefined();
  });
  it("computes an absolute date for day presets", () => {
    expect(expiryFromPreset("30d", NOW)).toBe(new Date(NOW + 30 * 86_400_000).toISOString());
  });
});

describe("scope catalog", () => {
  it("derives resource:action scopes from the RBAC matrix", () => {
    expect(SCOPE_GROUPS.length).toBeGreaterThan(0);
    expect(ALL_SCOPE_STRINGS).toContain("monitor:read");
    expect(ALL_SCOPE_STRINGS.every((s) => s.includes(":"))).toBe(true);
  });
});

// ── Audit logs ───────────────────────────────────────────────────────────────

describe("audit log helpers", () => {
  it("humanizes action keys", () => {
    expect(actionLabel("organization.updated")).toBe("Organization updated");
    expect(actionLabel("member.role_updated")).toBe("Member role updated");
  });
  it("labels actor types", () => {
    expect(actorTypeLabel("api_key")).toBe("API key");
    expect(actorTypeLabel("user")).toBe("User");
  });
  it("derives result from the action", () => {
    expect(auditResult("billing.payment_failed").ok).toBe(false);
    expect(auditResult("organization.updated").ok).toBe(true);
  });
  it("flattens rows for CSV export", () => {
    const rows: AuditLogRow[] = [
      {
        id: "1",
        organizationId: "o1",
        actorId: "u1",
        actorType: "user",
        action: "organization.updated",
        resourceType: "organization",
        resourceId: "o1",
        ipAddress: "1.2.3.4",
        userAgent: null,
        metadata: null,
        createdAt: "2026-06-28T00:00:00Z",
      },
    ];
    const csv = auditCsvRows(rows);
    expect(csv[0]).toMatchObject({ action: "organization.updated", ipAddress: "1.2.3.4", result: "Success" });
  });
});

// ── Sessions ─────────────────────────────────────────────────────────────────

describe("deviceLabel", () => {
  it("parses browser + OS from a user agent", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
    expect(deviceLabel(ua)).toBe("Chrome on macOS");
  });
  it("handles missing user agents", () => {
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});

// ── Profile prefs ────────────────────────────────────────────────────────────

describe("normalizeProfilePrefs", () => {
  it("falls back to defaults for garbage input", () => {
    expect(normalizeProfilePrefs(null)).toEqual(defaultProfilePrefs());
    expect(normalizeProfilePrefs("nope")).toEqual(defaultProfilePrefs());
  });
  it("keeps valid values and rejects unknown languages", () => {
    const prefs = normalizeProfilePrefs({ language: "fr", notifyIncidents: false, timezone: "UTC" });
    expect(prefs.language).toBe("fr");
    expect(prefs.notifyIncidents).toBe(false);
    expect(prefs.timezone).toBe("UTC");
    expect(normalizeProfilePrefs({ language: "xx" }).language).toBe("en");
  });
});
