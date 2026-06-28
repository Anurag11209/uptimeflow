/**
 * Pure, React-free form state + validation + payload builders for the status
 * page create/edit form. Mirrors the server-side Zod rules so the UI fails fast
 * and the two never drift. Unit-tested in tests/status-pages.test.ts.
 */

import type {
  SocialLink,
  StatusPageBranding,
  StatusPagePayload,
  StatusPageSummary,
  StatusPageVisibility,
} from "@/lib/status-pages";

export interface StatusPageFormState {
  name: string;
  slug: string;
  description: string;
  visibility: StatusPageVisibility;
  timezone: string;
  customDomain: string;
  logoUrl: string;
  faviconUrl: string;
  accent: string;
  footerText: string;
  socialLinks: SocialLink[];
}

export type StatusPageFormErrors = Partial<Record<keyof StatusPageFormState, string>>;

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Loose hostname check (label.label…), no scheme/path — matches a custom domain.
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

export function defaultStatusPageForm(): StatusPageFormState {
  return {
    name: "",
    slug: "",
    description: "",
    visibility: "PUBLIC",
    timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC",
    customDomain: "",
    logoUrl: "",
    faviconUrl: "",
    accent: "",
    footerText: "",
    socialLinks: [],
  };
}

export function formFromStatusPage(page: StatusPageSummary): StatusPageFormState {
  const b = page.branding ?? {};
  return {
    name: page.name,
    slug: page.slug,
    description: page.description ?? "",
    visibility: page.visibility,
    timezone: b.timezone ?? defaultStatusPageForm().timezone,
    customDomain: page.customDomain ?? "",
    logoUrl: b.logoUrl ?? "",
    faviconUrl: b.faviconUrl ?? "",
    accent: b.accent ?? "",
    footerText: b.footerText ?? "",
    socialLinks: b.socialLinks ?? [],
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

export function validateStatusPageForm(state: StatusPageFormState): StatusPageFormErrors {
  const errors: StatusPageFormErrors = {};

  if (!state.name.trim()) errors.name = "Required";
  else if (state.name.trim().length > 120) errors.name = "Must be 120 characters or fewer";

  const slug = state.slug.trim();
  if (!slug) errors.slug = "Required";
  else if (slug.length < 2 || slug.length > 63) errors.slug = "Must be 2–63 characters";
  else if (!SLUG_RE.test(slug)) errors.slug = "Lowercase letters, numbers, single hyphens";

  if (state.description.length > 1000) errors.description = "Must be 1000 characters or fewer";

  const domain = state.customDomain.trim();
  if (domain && !HOST_RE.test(domain)) errors.customDomain = "Enter a valid hostname (status.acme.com)";

  if (state.logoUrl.trim() && !isValidUrl(state.logoUrl.trim())) errors.logoUrl = "Enter a valid URL";
  if (state.faviconUrl.trim() && !isValidUrl(state.faviconUrl.trim()))
    errors.faviconUrl = "Enter a valid URL";

  if (state.accent.trim() && !HEX_RE.test(state.accent.trim()))
    errors.accent = "Use a hex color like #2fd180";

  if (state.footerText.length > 500) errors.footerText = "Must be 500 characters or fewer";

  if (state.socialLinks.some((l) => !l.label.trim() || !isValidUrl(l.url.trim())))
    errors.socialLinks = "Each link needs a label and a valid URL";

  return errors;
}

export function isFormValid(errors: StatusPageFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

/** Collapse branding fields; returns null when nothing is set (clears the column). */
export function buildBranding(state: StatusPageFormState): StatusPageBranding | null {
  const branding: StatusPageBranding = {};
  if (state.logoUrl.trim()) branding.logoUrl = state.logoUrl.trim();
  if (state.faviconUrl.trim()) branding.faviconUrl = state.faviconUrl.trim();
  if (state.accent.trim()) branding.accent = state.accent.trim();
  if (state.footerText.trim()) branding.footerText = state.footerText.trim();
  if (state.timezone.trim()) branding.timezone = state.timezone.trim();
  const links = state.socialLinks
    .filter((l) => l.label.trim() && l.url.trim())
    .map((l) => ({ label: l.label.trim(), url: l.url.trim() }));
  if (links.length) branding.socialLinks = links;
  return Object.keys(branding).length ? branding : null;
}

export function buildStatusPagePayload(state: StatusPageFormState): StatusPagePayload {
  return {
    name: state.name.trim(),
    slug: state.slug.trim(),
    description: state.description.trim() || null,
    customDomain: state.customDomain.trim() || null,
    visibility: state.visibility,
    branding: buildBranding(state),
  };
}
