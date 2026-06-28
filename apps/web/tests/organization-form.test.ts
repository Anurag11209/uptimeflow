import { describe, expect, it } from "vitest";
import type { OrgSettings } from "../lib/organization";
import {
  buildOrgSettingsPayload,
  formFromOrgSettings,
  isFormValid,
  validateOrgSettingsForm,
  type OrgSettingsFormState,
} from "../lib/organization-form";

function form(overrides: Partial<OrgSettingsFormState> = {}): OrgSettingsFormState {
  return {
    name: "Acme",
    slug: "acme",
    logo: "",
    timezone: "",
    billingContact: "",
    defaultRegion: "",
    defaultAlertPolicyId: "",
    ...overrides,
  };
}

describe("validateOrgSettingsForm", () => {
  it("passes a minimal valid form", () => {
    expect(isFormValid(validateOrgSettingsForm(form()))).toBe(true);
  });

  it("requires a name", () => {
    expect(validateOrgSettingsForm(form({ name: "  " })).name).toBeDefined();
  });

  it("enforces slug rules", () => {
    expect(validateOrgSettingsForm(form({ slug: "a" })).slug).toBeDefined();
    expect(validateOrgSettingsForm(form({ slug: "Bad Slug" })).slug).toBeDefined();
    expect(validateOrgSettingsForm(form({ slug: "acme-prod" })).slug).toBeUndefined();
  });

  it("validates the logo URL and billing email", () => {
    expect(validateOrgSettingsForm(form({ logo: "nope" })).logo).toBeDefined();
    expect(validateOrgSettingsForm(form({ logo: "https://x.com/l.png" })).logo).toBeUndefined();
    expect(validateOrgSettingsForm(form({ billingContact: "bad" })).billingContact).toBeDefined();
    expect(validateOrgSettingsForm(form({ billingContact: "a@b.com" })).billingContact).toBeUndefined();
  });
});

describe("buildOrgSettingsPayload", () => {
  it("trims values and nullifies empties", () => {
    const payload = buildOrgSettingsPayload(
      form({ name: " Acme ", slug: " acme ", timezone: "", billingContact: "", defaultRegion: "" }),
    );
    expect(payload).toMatchObject({
      name: "Acme",
      slug: "acme",
      logo: null,
      timezone: null,
      billingContact: null,
      defaultRegion: null,
    });
  });

  it("passes through a chosen region", () => {
    expect(buildOrgSettingsPayload(form({ defaultRegion: "EU_WEST" })).defaultRegion).toBe("EU_WEST");
  });
});

describe("formFromOrgSettings", () => {
  it("maps a settings object to editable form state", () => {
    const s: OrgSettings = {
      id: "1",
      name: "Acme",
      slug: "acme",
      logo: null,
      timezone: "UTC",
      billingContact: null,
      defaultRegion: "NA_EAST",
      defaultAlertPolicyId: null,
      createdAt: "2026-01-01T00:00:00Z",
    };
    const state = formFromOrgSettings(s);
    expect(state.timezone).toBe("UTC");
    expect(state.defaultRegion).toBe("NA_EAST");
    expect(state.logo).toBe("");
  });
});
