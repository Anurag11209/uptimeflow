/**
 * Pure, React-free form state + validation for the organization settings form.
 * Mirrors the server-side Zod rules so the UI fails fast. Unit-tested in
 * tests/organization-form.test.ts.
 */

import type { OrgSettings, OrgSettingsPayload, ProbeRegion } from "@/lib/organization";

export interface OrgSettingsFormState {
  name: string;
  slug: string;
  logo: string;
  timezone: string;
  billingContact: string;
  defaultRegion: ProbeRegion | "";
  defaultAlertPolicyId: string;
}

export type OrgSettingsFormErrors = Partial<Record<keyof OrgSettingsFormState, string>>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function formFromOrgSettings(s: OrgSettings): OrgSettingsFormState {
  return {
    name: s.name,
    slug: s.slug,
    logo: s.logo ?? "",
    timezone: s.timezone ?? "",
    billingContact: s.billingContact ?? "",
    defaultRegion: s.defaultRegion ?? "",
    defaultAlertPolicyId: s.defaultAlertPolicyId ?? "",
  };
}

function isValidUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateOrgSettingsForm(state: OrgSettingsFormState): OrgSettingsFormErrors {
  const errors: OrgSettingsFormErrors = {};

  if (!state.name.trim()) errors.name = "Required";
  else if (state.name.trim().length > 120) errors.name = "Must be 120 characters or fewer";

  const slug = state.slug.trim();
  if (!slug) errors.slug = "Required";
  else if (slug.length < 2 || slug.length > 48) errors.slug = "Must be 2–48 characters";
  else if (!SLUG_RE.test(slug)) errors.slug = "Lowercase letters, numbers, single hyphens";

  if (state.logo.trim() && !isValidUrl(state.logo.trim())) errors.logo = "Enter a valid URL";
  if (state.timezone.trim().length > 64) errors.timezone = "Too long";
  if (state.billingContact.trim() && !EMAIL_RE.test(state.billingContact.trim()))
    errors.billingContact = "Enter a valid email";

  return errors;
}

export function isFormValid(errors: OrgSettingsFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

export function buildOrgSettingsPayload(state: OrgSettingsFormState): OrgSettingsPayload {
  return {
    name: state.name.trim(),
    slug: state.slug.trim(),
    logo: state.logo.trim() || null,
    timezone: state.timezone.trim() || null,
    billingContact: state.billingContact.trim() || null,
    defaultRegion: state.defaultRegion || null,
    defaultAlertPolicyId: state.defaultAlertPolicyId.trim() || null,
  };
}
