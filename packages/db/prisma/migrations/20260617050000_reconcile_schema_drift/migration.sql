-- Reconcile pre-existing drift between schema.prisma and the committed
-- migration history (predates Phase 10; surfaced while diagnosing billing).
-- Two items the schema already declared but no migration had applied:
--   1. members.role default — schema says 'viewer'; phase1_init created 'member'.
--   2. audit_logs (resourceType, resourceId) index — declared, never created.
-- Forward-only and idempotent: the index uses IF NOT EXISTS so this is safe in
-- environments where it may already exist (e.g. a db-push'd dev database).

-- AlterTable
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'viewer';

-- CreateIndex
CREATE INDEX IF NOT EXISTS "audit_logs_resourceType_resourceId_idx" ON "audit_logs"("resourceType", "resourceId");
