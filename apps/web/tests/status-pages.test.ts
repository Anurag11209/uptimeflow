import { describe, expect, it } from "vitest";
import {
  componentStatusLabel,
  impactMeta,
  incidentStatusMeta,
  overallStatus,
  publicStatusUrl,
  subscriberStatusMeta,
  visibilityMeta,
  type ComponentStatus,
  type StatusPageSummary,
} from "../lib/status-pages";
import {
  buildBranding,
  buildStatusPagePayload,
  defaultStatusPageForm,
  formFromStatusPage,
  isFormValid,
  validateStatusPageForm,
  type StatusPageFormState,
} from "../lib/status-page-form";

function form(overrides: Partial<StatusPageFormState> = {}): StatusPageFormState {
  return { ...defaultStatusPageForm(), name: "Acme", slug: "acme", ...overrides };
}

describe("validateStatusPageForm", () => {
  it("passes a minimal valid form", () => {
    expect(isFormValid(validateStatusPageForm(form()))).toBe(true);
  });

  it("requires a name", () => {
    expect(validateStatusPageForm(form({ name: "  " })).name).toBeDefined();
  });

  it("enforces slug format and length", () => {
    expect(validateStatusPageForm(form({ slug: "a" })).slug).toBeDefined();
    expect(validateStatusPageForm(form({ slug: "Bad Slug" })).slug).toBeDefined();
    expect(validateStatusPageForm(form({ slug: "-acme" })).slug).toBeDefined();
    expect(validateStatusPageForm(form({ slug: "acme-prod" })).slug).toBeUndefined();
  });

  it("validates the accent as a hex color", () => {
    expect(validateStatusPageForm(form({ accent: "red" })).accent).toBeDefined();
    expect(validateStatusPageForm(form({ accent: "#2fd180" })).accent).toBeUndefined();
    expect(validateStatusPageForm(form({ accent: "#fff" })).accent).toBeUndefined();
  });

  it("validates logo and favicon URLs", () => {
    expect(validateStatusPageForm(form({ logoUrl: "notaurl" })).logoUrl).toBeDefined();
    expect(validateStatusPageForm(form({ logoUrl: "https://x.com/l.svg" })).logoUrl).toBeUndefined();
  });

  it("rejects a malformed custom domain", () => {
    expect(validateStatusPageForm(form({ customDomain: "no spaces" })).customDomain).toBeDefined();
    expect(validateStatusPageForm(form({ customDomain: "status.acme.com" })).customDomain).toBeUndefined();
  });

  it("requires a label and valid url on each social link", () => {
    expect(
      validateStatusPageForm(form({ socialLinks: [{ label: "", url: "https://x.com" }] }))
        .socialLinks,
    ).toBeDefined();
    expect(
      validateStatusPageForm(form({ socialLinks: [{ label: "X", url: "bad" }] })).socialLinks,
    ).toBeDefined();
    expect(
      validateStatusPageForm(form({ socialLinks: [{ label: "X", url: "https://x.com" }] }))
        .socialLinks,
    ).toBeUndefined();
  });

  it("caps description length", () => {
    expect(validateStatusPageForm(form({ description: "x".repeat(1001) })).description).toBeDefined();
  });
});

describe("buildBranding", () => {
  it("returns null when no branding fields are set", () => {
    expect(buildBranding(form({ timezone: "" }))).toBeNull();
  });

  it("collects set branding fields and trims them", () => {
    const branding = buildBranding(
      form({
        accent: "#2fd180",
        logoUrl: " https://x.com/l.svg ",
        footerText: " © Acme ",
        timezone: "UTC",
        socialLinks: [{ label: " X ", url: " https://x.com " }],
      }),
    );
    expect(branding).toMatchObject({
      accent: "#2fd180",
      logoUrl: "https://x.com/l.svg",
      footerText: "© Acme",
      timezone: "UTC",
      socialLinks: [{ label: "X", url: "https://x.com" }],
    });
  });

  it("drops incomplete social links", () => {
    const branding = buildBranding(
      form({ timezone: "", socialLinks: [{ label: "X", url: "" }] }),
    );
    expect(branding).toBeNull();
  });
});

describe("buildStatusPagePayload", () => {
  it("maps trimmed fields and nullifies empties", () => {
    const payload = buildStatusPagePayload(
      form({ name: " Acme ", slug: " acme ", description: "", customDomain: "", visibility: "UNLISTED" }),
    );
    expect(payload.name).toBe("Acme");
    expect(payload.slug).toBe("acme");
    expect(payload.description).toBeNull();
    expect(payload.customDomain).toBeNull();
    expect(payload.visibility).toBe("UNLISTED");
  });
});

describe("formFromStatusPage", () => {
  it("round-trips a summary into editable form state", () => {
    const summary: StatusPageSummary = {
      id: "1",
      name: "Acme",
      slug: "acme",
      description: "Hi",
      customDomain: "status.acme.com",
      visibility: "PRIVATE",
      isPublic: false,
      branding: { accent: "#fff", footerText: "© Acme", timezone: "Europe/London" },
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    const state = formFromStatusPage(summary);
    expect(state.visibility).toBe("PRIVATE");
    expect(state.accent).toBe("#fff");
    expect(state.timezone).toBe("Europe/London");
    expect(state.customDomain).toBe("status.acme.com");
  });
});

describe("meta helpers", () => {
  it("maps visibility to label + tone", () => {
    expect(visibilityMeta("PUBLIC")).toEqual({ label: "Public", tone: "up" });
    expect(visibilityMeta("UNLISTED").tone).toBe("brand");
    expect(visibilityMeta("PRIVATE").tone).toBe("muted");
  });

  it("maps incident impact", () => {
    expect(impactMeta("CRITICAL").tone).toBe("down");
    expect(impactMeta("MAINTENANCE").label).toBe("Maintenance");
  });

  it("treats resolved incidents as up-toned", () => {
    expect(incidentStatusMeta("RESOLVED").tone).toBe("up");
    expect(incidentStatusMeta("INVESTIGATING").tone).toBe("brand");
  });

  it("maps subscriber status", () => {
    expect(subscriberStatusMeta("ACTIVE").tone).toBe("up");
    expect(subscriberStatusMeta("UNSUBSCRIBED").tone).toBe("muted");
  });
});

describe("overallStatus", () => {
  it("returns OPERATIONAL for an empty list", () => {
    expect(overallStatus([])).toBe("OPERATIONAL");
  });

  it("returns the worst component status", () => {
    const comps: { status: ComponentStatus }[] = [
      { status: "OPERATIONAL" },
      { status: "DEGRADED_PERFORMANCE" },
      { status: "MAJOR_OUTAGE" },
    ];
    expect(overallStatus(comps)).toBe("MAJOR_OUTAGE");
  });

  it("ranks maintenance below degraded", () => {
    const comps: { status: ComponentStatus }[] = [
      { status: "UNDER_MAINTENANCE" },
      { status: "DEGRADED_PERFORMANCE" },
    ];
    expect(overallStatus(comps)).toBe("DEGRADED_PERFORMANCE");
  });
});

describe("misc helpers", () => {
  it("labels component statuses", () => {
    expect(componentStatusLabel("OPERATIONAL")).toBe("Operational");
    expect(componentStatusLabel("MAJOR_OUTAGE")).toBe("Major outage");
  });

  it("builds the public status url", () => {
    expect(publicStatusUrl({ slug: "acme" })).toBe("/status/acme");
  });
});
