-- Phase 12 · Status-page subscriber tokens
--
-- Adds distinct confirm/unsubscribe tokens to status_page_subscribers so the
-- double opt-in and one-click unsubscribe links never share a capability, and
-- makes the legacy `token` nullable. Subscriber columns ONLY — the members.role
-- default and audit_logs index are already on main (20260617050000) and are
-- deliberately excluded here.

-- AlterTable
ALTER TABLE "status_page_subscribers" ADD COLUMN     "unsubscribeToken" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "verificationToken" TEXT,
ALTER COLUMN "token" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_verificationToken_key" ON "status_page_subscribers"("verificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_unsubscribeToken_key" ON "status_page_subscribers"("unsubscribeToken");
