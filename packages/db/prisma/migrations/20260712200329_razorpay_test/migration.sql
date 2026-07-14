/*
  Warnings:

  - You are about to drop the column `stripeEventId` on the `invoice_events` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[razorpayPlanId]` on the table `billing_plans` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerEventId]` on the table `invoice_events` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpayCustomerId]` on the table `subscriptions` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpaySubscriptionId]` on the table `subscriptions` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `providerEventId` to the `invoice_events` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BillingProviderKind" AS ENUM ('STRIPE', 'RAZORPAY');

-- DropIndex
DROP INDEX "invoice_events_stripeEventId_key";

-- AlterTable
ALTER TABLE "billing_plans" ADD COLUMN     "razorpayPlanId" TEXT;

-- AlterTable
ALTER TABLE "invoice_events" DROP COLUMN "stripeEventId",
ADD COLUMN     "provider" "BillingProviderKind" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "providerEventId" TEXT NOT NULL,
ADD COLUMN     "razorpayInvoiceId" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "provider" "BillingProviderKind" NOT NULL DEFAULT 'STRIPE',
ADD COLUMN     "razorpayCustomerId" TEXT,
ADD COLUMN     "razorpayPlanId" TEXT,
ADD COLUMN     "razorpaySubscriptionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_razorpayPlanId_key" ON "billing_plans"("razorpayPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_events_providerEventId_key" ON "invoice_events"("providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_razorpayCustomerId_key" ON "subscriptions"("razorpayCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_razorpaySubscriptionId_key" ON "subscriptions"("razorpaySubscriptionId");
