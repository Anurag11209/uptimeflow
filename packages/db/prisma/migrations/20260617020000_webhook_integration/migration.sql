-- CreateTable
CREATE TABLE "webhook_integrations" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "secret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "webhook_integrations_organizationId_deletedAt_idx" ON "webhook_integrations"("organizationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "webhook_integrations" ADD CONSTRAINT "webhook_integrations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

