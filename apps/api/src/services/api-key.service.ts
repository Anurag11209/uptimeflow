import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@backend-uptime/db";

/**
 * Organization-scoped API keys.
 *
 * The plaintext token is shown exactly once, at creation; only its SHA-256
 * digest is persisted. SHA-256 (not a slow password hash) is the right choice
 * here: tokens carry 256 bits of entropy, so there is nothing to brute-force,
 * and verification sits on the hot request path. Lookups are O(1) on the unique
 * `hashedKey` column.
 */

export const API_KEY_PREFIX = "uf_";

export interface VerifiedApiKey {
  id: string;
  name: string;
  organizationId: string;
  scopes: string[];
}

export interface CreatedApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  /** Plaintext token — returned ONCE at creation and never stored. */
  token: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  /** Member who minted the key; lets the UI surface personal access tokens. */
  createdById: string | null;
  createdAt: Date;
}

export interface CreateApiKeyInput {
  organizationId: string;
  name: string;
  scopes: string[];
  expiresAt?: Date | null;
  createdById?: string | null;
}

export interface ApiKeyService {
  create(input: CreateApiKeyInput): Promise<CreatedApiKey>;
  /** Resolve a plaintext token to a live key, or null if invalid/expired/revoked. */
  verify(token: string): Promise<VerifiedApiKey | null>;
  list(organizationId: string): Promise<ApiKeySummary[]>;
  revoke(organizationId: string, id: string): Promise<boolean>;
}

export interface ApiKeyServiceDeps {
  prisma: PrismaClient;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createApiKeyService(deps: ApiKeyServiceDeps): ApiKeyService {
  const { prisma } = deps;

  return {
    async create({ organizationId, name, scopes, expiresAt = null, createdById = null }) {
      const token = `${API_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
      // Stored to let the UI identify a key without revealing it.
      const prefix = token.slice(0, API_KEY_PREFIX.length + 8);

      const record = await prisma.apiKey.create({
        data: {
          organizationId,
          name,
          scopes,
          hashedKey: hashToken(token),
          prefix,
          expiresAt,
          createdById,
        },
        select: { id: true, name: true },
      });

      return { id: record.id, name: record.name, prefix, scopes, expiresAt, token };
    },

    async verify(token) {
      if (!token.startsWith(API_KEY_PREFIX)) return null;

      const record = await prisma.apiKey.findUnique({
        where: { hashedKey: hashToken(token) },
        select: {
          id: true,
          name: true,
          organizationId: true,
          scopes: true,
          expiresAt: true,
          revokedAt: true,
          deletedAt: true,
        },
      });
      if (!record || record.revokedAt || record.deletedAt) return null;
      if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) return null;

      // Best-effort usage stamp — never block or fail auth on it.
      void prisma.apiKey
        .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);

      return {
        id: record.id,
        name: record.name,
        organizationId: record.organizationId,
        scopes: record.scopes,
      };
    },

    async list(organizationId) {
      return prisma.apiKey.findMany({
        where: { organizationId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          prefix: true,
          scopes: true,
          lastUsedAt: true,
          expiresAt: true,
          revokedAt: true,
          createdById: true,
          createdAt: true,
        },
      });
    },

    async revoke(organizationId, id) {
      const now = new Date();
      // Scope the write to the org so a key id from another tenant can't be hit.
      const result = await prisma.apiKey.updateMany({
        where: { id, organizationId, deletedAt: null },
        data: { revokedAt: now, deletedAt: now },
      });
      return result.count > 0;
    },
  };
}
