import { z } from "zod";

export const idSchema = z.string().min(1).max(64);

export const slugSchema = z
  .string()
  .min(2, "Slug must be at least 2 characters.")
  .max(48, "Slug must be at most 48 characters.")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, numbers and hyphens.");

export const emailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.");

/**
 * Length-first password policy (NIST 800-63B): long minimum, no arbitrary
 * composition rules. Breach checking can be layered on later.
 */
export const passwordSchema = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password must be at most 128 characters.");

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
