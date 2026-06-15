-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('SLACK', 'DISCORD', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "IntegrationDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SUCCESS', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "slack_integrations" (
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

    CONSTRAINT "slack_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_deliveries" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "integrationType" "IntegrationType" NOT NULL,
    "integrationId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "status" "IntegrationDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestUrl" TEXT,
    "responseStatus" INTEGER,
    "error" TEXT,
    "dedupeKey" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slack_integrations_organizationId_deletedAt_idx" ON "slack_integrations"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_deliveries_dedupeKey_key" ON "integration_deliveries"("dedupeKey");

-- CreateIndex
CREATE INDEX "integration_deliveries_organizationId_createdAt_idx" ON "integration_deliveries"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "integration_deliveries_integrationType_integrationId_create_idx" ON "integration_deliveries"("integrationType", "integrationId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "slack_integrations" ADD CONSTRAINT "slack_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

