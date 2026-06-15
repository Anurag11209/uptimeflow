-- Align audit_logs.id with the schema (`@db.Uuid`, uuid(7)). Phase 1 created the
-- column as TEXT; existing ids are application-generated UUID strings, so the
-- cast is lossless (no data dropped).
ALTER TABLE "audit_logs" ALTER COLUMN "id" SET DATA TYPE UUID USING "id"::uuid;
