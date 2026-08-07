-- Telegram and Microsoft Teams alert delivery.
--
-- Both follow the SlackIntegration/DiscordIntegration shape exactly: the
-- credential lives in a dedicated per-provider table, and an AlertChannel of
-- the matching type references it by id (config = { integrationId }). Keeping
-- credentials out of alert_channels.config means one row to rotate when a token
-- changes, and no secret in a general-purpose JSON column.
--
-- Additive only: two enum values and two tables. No existing column is altered,
-- so this is safe to apply ahead of the deploy that starts writing to them.

-- ── Enum values ─────────────────────────────────────────────────────────────
-- Postgres cannot add an enum value and use it in the same transaction, but
-- Prisma runs each migration file in its own transaction and nothing here
-- references the new values, so this is safe as written.
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'TELEGRAM';
ALTER TYPE "IntegrationType" ADD VALUE IF NOT EXISTS 'MICROSOFT_TEAMS';

-- ── telegram_integrations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "telegram_integrations" (
    "id"             UUID         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "botToken"       TEXT         NOT NULL,
    "chatId"         TEXT         NOT NULL,
    "enabled"        BOOLEAN      NOT NULL DEFAULT true,
    "createdById"    TEXT,
    "updatedById"    TEXT,
    "deletedById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "deletedAt"      TIMESTAMP(3),

    CONSTRAINT "telegram_integrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "telegram_integrations_organizationId_deletedAt_idx"
    ON "telegram_integrations" ("organizationId", "deletedAt");

ALTER TABLE "telegram_integrations"
    ADD CONSTRAINT "telegram_integrations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── ms_teams_integrations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ms_teams_integrations" (
    "id"             UUID         NOT NULL,
    "organizationId" TEXT         NOT NULL,
    "name"           TEXT         NOT NULL,
    "webhookUrl"     TEXT         NOT NULL,
    "enabled"        BOOLEAN      NOT NULL DEFAULT true,
    "createdById"    TEXT,
    "updatedById"    TEXT,
    "deletedById"    TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "deletedAt"      TIMESTAMP(3),

    CONSTRAINT "ms_teams_integrations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ms_teams_integrations_organizationId_deletedAt_idx"
    ON "ms_teams_integrations" ("organizationId", "deletedAt");

ALTER TABLE "ms_teams_integrations"
    ADD CONSTRAINT "ms_teams_integrations_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "organizations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
