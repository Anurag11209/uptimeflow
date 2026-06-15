import { z } from "zod";
import { ORG_ROLES } from "../roles.js";
import { emailSchema, paginationQuerySchema, slugSchema } from "./common.js";

export const orgRoleSchema = z.enum(ORG_ROLES);

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(60),
  slug: slugSchema,
  logo: z.string().url().max(2048).optional(),
});

export const updateOrganizationSchema = createOrganizationSchema.partial();

export const inviteMemberSchema = z.object({
  email: emailSchema,
  role: orgRoleSchema.exclude(["owner"]),
});

export const updateMemberRoleSchema = z.object({
  role: orgRoleSchema.exclude(["owner"]),
});

export const listMembersQuerySchema = paginationQuerySchema.extend({
  query: z.string().trim().max(120).optional(),
  role: orgRoleSchema.optional(),
});

export const listInvitationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["pending", "accepted", "rejected", "canceled"]).optional(),
});

export const auditLogQuerySchema = paginationQuerySchema.extend({
  action: z.string().trim().max(80).optional(),
  actorId: z.string().max(64).optional(),
  resourceType: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
