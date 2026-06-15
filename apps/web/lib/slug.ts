/**
 * Mirror of the slug rules enforced server-side: lowercase, alphanumeric,
 * single hyphens, trimmed, capped at 48 chars. Used to auto-suggest a slug
 * while the user types an organization name.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    .replace(/-$/, "");
}
