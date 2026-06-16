-- Phase 10 · Billing & SaaS monetization
--
-- Additive to the Phase 2 billing scaffold (subscriptions, usage_records). Adds
-- the plan catalog (billing_plans, seeded as data) and the Stripe webhook event
-- ledger (invoice_events, idempotent via a unique stripeEventId). The PlanTier
-- value PRO is renamed to GROWTH in place — a non-destructive ALTER TYPE RENAME
-- VALUE (no rows reference it yet; this preserves any that ever did).

-- RenameEnumValue (non-destructive: keeps the type, no DROP/recreate)
ALTER TYPE "PlanTier" RENAME VALUE 'PRO' TO 'GROWTH';

-- CreateEnum
CREATE TYPE "InvoiceEventType" AS ENUM ('CHECKOUT_COMPLETED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_DELETED', 'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "planId" UUID,
ADD COLUMN     "stripePriceId" TEXT;

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" UUID NOT NULL,
    "tier" "PlanTier" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "stripeProductId" TEXT,
    "stripePriceId" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "monitorLimit" INTEGER,
    "seatLimit" INTEGER,
    "statusPageLimit" INTEGER,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "voiceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ssoEnabled" BOOLEAN NOT NULL DEFAULT false,
    "advancedAnalytics" BOOLEAN NOT NULL DEFAULT false,
    "meteredAllowances" JSONB,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_events" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subscriptionId" UUID,
    "stripeEventId" TEXT NOT NULL,
    "type" "InvoiceEventType" NOT NULL,
    "stripeInvoiceId" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "status" TEXT,
    "hostedInvoiceUrl" TEXT,
    "invoicePdfUrl" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_tier_key" ON "billing_plans"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_stripePriceId_key" ON "billing_plans"("stripePriceId");

-- CreateIndex
CREATE INDEX "billing_plans_tier_idx" ON "billing_plans"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_events_stripeEventId_key" ON "invoice_events"("stripeEventId");

-- CreateIndex
CREATE INDEX "invoice_events_organizationId_createdAt_idx" ON "invoice_events"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "invoice_events_subscriptionId_idx" ON "invoice_events"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_planId_idx" ON "subscriptions"("planId");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "billing_plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_events" ADD CONSTRAINT "invoice_events_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
