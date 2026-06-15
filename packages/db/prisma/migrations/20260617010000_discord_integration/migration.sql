-- CreateTable
CREATE TABLE "discord_integrations" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "webhookUrl" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "discord_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discord_integrations_organizationId_deletedAt_idx" ON "discord_integrations"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "discord_integrations" ADD CONSTRAINT "discord_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

