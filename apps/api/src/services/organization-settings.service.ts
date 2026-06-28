import type { PrismaClient, ProbeRegion } from "@backend-uptime/db";
import type { AuditLogService } from "./audit-log.service.js";

/**
 * Organization profile + control-plane defaults. The Organization row (owned by
 * the Better Auth org plugin) only has name/slug/logo columns plus a free-form
 * `metadata` string, so the extra operator settings (timezone, billing contact,
 * default region, default alert policy) live JSON-encoded in `metadata`. This
 * service is the single read/write surface for that blend — the existing
 * /me + /overview endpoints never return metadata, so the dashboard could not
 * otherwise show or edit these. No schema migration is required.
 */

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string | null;
  billingContact: string | null;
  defaultRegion: ProbeRegion | null;
  defaultAlertPolicyId: string | null;
  createdAt: Date;
}

export interface OrgSettingsUpdate {
  name?: string;
  slug?: string;
  logo?: string | null;
  timezone?: string | null;
  billingContact?: string | null;
  defaultRegion?: ProbeRegion | null;
  defaultAlertPolicyId?: string | null;
}

export interface SettingsActor {
  userId: string | null;
  actorType: "user" | "api_key";
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface OrgSettingsService {
  get(organizationId: string): Promise<OrgSettings | null>;
  update(
    organizationId: string,
    input: OrgSettingsUpdate,
    actor: SettingsActor,
  ): Promise<OrgSettings | null>;
}

// The operator-tunable bag stored inside Organization.metadata.
interface OrgMetadata {
  timezone?: string | null;
  billingContact?: string | null;
  defaultRegion?: ProbeRegion | null;
  defaultAlertPolicyId?: string | null;
}

function parseMetadata(raw: string | null): OrgMetadata {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as OrgMetadata) : {};
  } catch {
    return {};
  }
}

type OrgRow = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  metadata: string | null;
  createdAt: Date;
};

function toSettings(row: OrgRow): OrgSettings {
  const meta = parseMetadata(row.metadata);
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    timezone: meta.timezone ?? null,
    billingContact: meta.billingContact ?? null,
    defaultRegion: meta.defaultRegion ?? null,
    defaultAlertPolicyId: meta.defaultAlertPolicyId ?? null,
    createdAt: row.createdAt,
  };
}

const SELECT = { id: true, name: true, slug: true, logo: true, metadata: true, createdAt: true };

export function createOrgSettingsService(deps: {
  prisma: PrismaClient;
  auditLogs?: AuditLogService;
}): OrgSettingsService {
  const { prisma, auditLogs } = deps;

  return {
    async get(organizationId) {
      const row = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: SELECT,
      });
      return row ? toSettings(row) : null;
    },

    async update(organizationId, input, actor) {
      const existing = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: SELECT,
      });
      if (!existing) return null;

      // Merge the metadata bag, treating `undefined` as "leave unchanged" and
      // `null` as "clear", so a partial PATCH never wipes sibling settings.
      const meta = parseMetadata(existing.metadata);
      if (input.timezone !== undefined) meta.timezone = input.timezone;
      if (input.billingContact !== undefined) meta.billingContact = input.billingContact;
      if (input.defaultRegion !== undefined) meta.defaultRegion = input.defaultRegion;
      if (input.defaultAlertPolicyId !== undefined) meta.defaultAlertPolicyId = input.defaultAlertPolicyId;

      const row = await prisma.organization.update({
        where: { id: organizationId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.logo !== undefined ? { logo: input.logo } : {}),
          metadata: JSON.stringify(meta),
        },
        select: SELECT,
      });

      await auditLogs?.log({
        organizationId,
        actorId: actor.userId,
        actorType: actor.actorType,
        action: "organization.updated",
        resourceType: "organization",
        resourceId: organizationId,
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      });

      return toSettings(row);
    },
  };
}
