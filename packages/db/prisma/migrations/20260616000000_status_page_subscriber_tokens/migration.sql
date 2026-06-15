-- AlterTable
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'viewer';

-- AlterTable
ALTER TABLE "status_page_subscribers" ADD COLUMN     "unsubscribeToken" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verificationToken" TEXT,
ALTER COLUMN "token" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_verificationToken_key" ON "status_page_subscribers"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_unsubscribeToken_key" ON "status_page_subscribers"("unsubscribeToken");

