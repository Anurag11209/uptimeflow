-- Phase 2: monitoring engine.
-- Materializes the monitoring tables (monitors, check_results, incidents,
-- monitor_daily_stats, maintenance_windows, ...) plus the rest of the
-- forward-declared control plane, so schema and database stay in sync.
-- The 10 Phase 1 + api_keys tables already exist and are intentionally omitted.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MonitorType" AS ENUM ('HTTP', 'TCP', 'PING', 'DNS', 'KEYWORD', 'SSL', 'PORT', 'HEARTBEAT', 'GRPC');

-- CreateEnum
CREATE TYPE "HttpMethod" AS ENUM ('GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS');

-- CreateEnum
CREATE TYPE "MonitorState" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "MonitorHealth" AS ENUM ('UP', 'DOWN', 'DEGRADED', 'PENDING', 'PAUSED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ProbeRegion" AS ENUM ('NA_EAST', 'NA_WEST', 'EU_WEST', 'EU_CENTRAL', 'AP_SOUTHEAST', 'AP_NORTHEAST', 'SA_EAST', 'AF_SOUTH');

-- CreateEnum
CREATE TYPE "AssertionSource" AS ENUM ('STATUS_CODE', 'RESPONSE_TIME', 'HEADER', 'BODY_TEXT', 'BODY_JSON', 'SSL_EXPIRY_DAYS', 'DNS_RECORD');

-- CreateEnum
CREATE TYPE "AssertionComparator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_CONTAINS', 'GREATER_THAN', 'LESS_THAN', 'MATCHES_REGEX', 'EXISTS');

-- CreateEnum
CREATE TYPE "CheckStatus" AS ENUM ('UP', 'DOWN', 'DEGRADED', 'TIMEOUT', 'ERROR');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'WARNING');

-- CreateEnum
CREATE TYPE "IncidentEventType" AS ENUM ('DETECTED', 'ACKNOWLEDGED', 'ESCALATED', 'NOTIFICATION_SENT', 'COMMENT', 'STATUS_CHANGED', 'RESOLVED', 'REOPENED');

-- CreateEnum
CREATE TYPE "AlertChannelType" AS ENUM ('EMAIL', 'SMS', 'VOICE', 'SLACK', 'DISCORD', 'TELEGRAM', 'MICROSOFT_TEAMS', 'WEBHOOK', 'PAGERDUTY', 'OPSGENIE');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DELIVERED', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "RotationType" AS ENUM ('DAILY', 'WEEKLY', 'BIWEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EscalationTargetType" AS ENUM ('USER', 'SCHEDULE', 'CHANNEL');

-- CreateEnum
CREATE TYPE "StatusPageVisibility" AS ENUM ('PUBLIC', 'UNLISTED', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ComponentStatus" AS ENUM ('OPERATIONAL', 'DEGRADED_PERFORMANCE', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "StatusPageIncidentStatus" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "StatusPageIncidentImpact" AS ENUM ('NONE', 'MINOR', 'MAJOR', 'CRITICAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'BUSINESS', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "SsoConnectionType" AS ENUM ('SAML', 'OIDC');

-- CreateTable
CREATE TABLE "monitor_groups" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "monitor_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitors" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "groupId" UUID,
    "name" TEXT NOT NULL,
    "type" "MonitorType" NOT NULL,
    "state" "MonitorState" NOT NULL DEFAULT 'ACTIVE',
    "health" "MonitorHealth" NOT NULL DEFAULT 'PENDING',
    "url" TEXT,
    "host" TEXT,
    "port" INTEGER,
    "httpMethod" "HttpMethod" DEFAULT 'GET',
    "requestHeaders" JSONB,
    "requestBody" TEXT,
    "expectedStatus" INTEGER DEFAULT 200,
    "keyword" TEXT,
    "keywordInverted" BOOLEAN NOT NULL DEFAULT false,
    "followRedirects" BOOLEAN NOT NULL DEFAULT true,
    "verifySsl" BOOLEAN NOT NULL DEFAULT true,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 30,
    "retries" INTEGER NOT NULL DEFAULT 2,
    "regions" "ProbeRegion"[],
    "confirmThreshold" INTEGER NOT NULL DEFAULT 1,
    "failureThreshold" INTEGER NOT NULL DEFAULT 1,
    "successThreshold" INTEGER NOT NULL DEFAULT 1,
    "escalationPolicyId" UUID,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "consecutiveSuccesses" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastResponseMs" INTEGER,
    "lastError" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_assertions" (
    "id" UUID NOT NULL,
    "monitorId" UUID NOT NULL,
    "source" "AssertionSource" NOT NULL,
    "comparator" "AssertionComparator" NOT NULL,
    "property" TEXT,
    "expected" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_assertions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_windows" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "recurrenceRule" TEXT,
    "suppressAlerts" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_results" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monitorId" UUID NOT NULL,
    "region" "ProbeRegion" NOT NULL,
    "status" "CheckStatus" NOT NULL,
    "statusCode" INTEGER,
    "responseMs" INTEGER,
    "errorType" TEXT,
    "errorMessage" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_daily_stats" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monitorId" UUID NOT NULL,
    "region" "ProbeRegion",
    "day" DATE NOT NULL,
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "upChecks" INTEGER NOT NULL DEFAULT 0,
    "downChecks" INTEGER NOT NULL DEFAULT 0,
    "uptimePct" DECIMAL(6,4) NOT NULL,
    "avgResponseMs" INTEGER,
    "p95ResponseMs" INTEGER,
    "p99ResponseMs" INTEGER,
    "downtimeSec" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "monitor_daily_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monitorId" UUID,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MAJOR',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "cause" TEXT,
    "fingerprint" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incident_events" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "type" "IncidentEventType" NOT NULL,
    "message" TEXT,
    "actorId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_channels" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "AlertChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "verifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "alert_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitor_channels" (
    "monitorId" UUID NOT NULL,
    "channelId" UUID NOT NULL,

    CONSTRAINT "monitor_channels_pkey" PRIMARY KEY ("monitorId","channelId")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channelId" UUID NOT NULL,
    "incidentId" UUID,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_policies" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "repeatCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "escalation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_steps" (
    "id" UUID NOT NULL,
    "policyId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_targets" (
    "id" UUID NOT NULL,
    "stepId" UUID NOT NULL,
    "type" "EscalationTargetType" NOT NULL,
    "userId" TEXT,
    "scheduleId" UUID,
    "channelId" UUID,

    CONSTRAINT "escalation_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_schedules" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "rotationType" "RotationType" NOT NULL DEFAULT 'WEEKLY',
    "handoffMinute" INTEGER NOT NULL DEFAULT 540,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "on_call_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_participants" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "on_call_overrides" (
    "id" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "on_call_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_pages" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "customDomain" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "StatusPageVisibility" NOT NULL DEFAULT 'PUBLIC',
    "passwordHash" TEXT,
    "branding" JSONB,
    "createdById" TEXT,
    "updatedById" TEXT,
    "deletedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "status_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_components" (
    "id" UUID NOT NULL,
    "statusPageId" UUID NOT NULL,
    "monitorId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "groupName" TEXT,
    "status" "ComponentStatus" NOT NULL DEFAULT 'OPERATIONAL',
    "position" INTEGER NOT NULL DEFAULT 0,
    "showUptime" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_page_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_incidents" (
    "id" UUID NOT NULL,
    "statusPageId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "status" "StatusPageIncidentStatus" NOT NULL DEFAULT 'INVESTIGATING',
    "impact" "StatusPageIncidentImpact" NOT NULL DEFAULT 'MINOR',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "status_page_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_incident_updates" (
    "id" UUID NOT NULL,
    "incidentId" UUID NOT NULL,
    "status" "StatusPageIncidentStatus" NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_page_incident_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_page_subscribers" (
    "id" UUID NOT NULL,
    "statusPageId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "token" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_page_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "monitorLimit" INTEGER,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhooks" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "events" TEXT[],
    "secret" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" UUID NOT NULL,
    "webhookId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sso_connections" (
    "id" UUID NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "SsoConnectionType" NOT NULL,
    "domain" TEXT,
    "config" JSONB NOT NULL,
    "scimEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MaintenanceWindowToMonitor" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_MaintenanceWindowToMonitor_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "monitor_groups_organizationId_deletedAt_idx" ON "monitor_groups"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "monitors_organizationId_deletedAt_idx" ON "monitors"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "monitors_organizationId_state_health_idx" ON "monitors"("organizationId", "state", "health");

-- CreateIndex
CREATE INDEX "monitors_groupId_idx" ON "monitors"("groupId");

-- CreateIndex
CREATE INDEX "monitors_escalationPolicyId_idx" ON "monitors"("escalationPolicyId");

-- CreateIndex
CREATE INDEX "monitor_assertions_monitorId_idx" ON "monitor_assertions"("monitorId");

-- CreateIndex
CREATE INDEX "maintenance_windows_organizationId_startsAt_idx" ON "maintenance_windows"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "check_results_monitorId_checkedAt_idx" ON "check_results"("monitorId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "check_results_organizationId_checkedAt_idx" ON "check_results"("organizationId", "checkedAt" DESC);

-- CreateIndex
CREATE INDEX "monitor_daily_stats_organizationId_day_idx" ON "monitor_daily_stats"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "monitor_daily_stats_monitorId_region_day_key" ON "monitor_daily_stats"("monitorId", "region", "day");

-- CreateIndex
CREATE INDEX "incidents_organizationId_status_startedAt_idx" ON "incidents"("organizationId", "status", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "incidents_monitorId_startedAt_idx" ON "incidents"("monitorId", "startedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "incidents_monitorId_fingerprint_key" ON "incidents"("monitorId", "fingerprint");

-- CreateIndex
CREATE INDEX "incident_events_incidentId_createdAt_idx" ON "incident_events"("incidentId", "createdAt");

-- CreateIndex
CREATE INDEX "alert_channels_organizationId_deletedAt_idx" ON "alert_channels"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "alert_channels_organizationId_type_idx" ON "alert_channels"("organizationId", "type");

-- CreateIndex
CREATE INDEX "monitor_channels_channelId_idx" ON "monitor_channels"("channelId");

-- CreateIndex
CREATE INDEX "notification_deliveries_organizationId_createdAt_idx" ON "notification_deliveries"("organizationId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "notification_deliveries_incidentId_idx" ON "notification_deliveries"("incidentId");

-- CreateIndex
CREATE INDEX "notification_deliveries_channelId_status_idx" ON "notification_deliveries"("channelId", "status");

-- CreateIndex
CREATE INDEX "escalation_policies_organizationId_deletedAt_idx" ON "escalation_policies"("organizationId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_steps_policyId_position_key" ON "escalation_steps"("policyId", "position");

-- CreateIndex
CREATE INDEX "escalation_targets_stepId_idx" ON "escalation_targets"("stepId");

-- CreateIndex
CREATE INDEX "escalation_targets_scheduleId_idx" ON "escalation_targets"("scheduleId");

-- CreateIndex
CREATE INDEX "escalation_targets_channelId_idx" ON "escalation_targets"("channelId");

-- CreateIndex
CREATE INDEX "on_call_schedules_organizationId_deletedAt_idx" ON "on_call_schedules"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "on_call_participants_userId_idx" ON "on_call_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "on_call_participants_scheduleId_userId_key" ON "on_call_participants"("scheduleId", "userId");

-- CreateIndex
CREATE INDEX "on_call_overrides_scheduleId_startsAt_idx" ON "on_call_overrides"("scheduleId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_slug_key" ON "status_pages"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "status_pages_customDomain_key" ON "status_pages"("customDomain");

-- CreateIndex
CREATE INDEX "status_pages_organizationId_deletedAt_idx" ON "status_pages"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "status_page_components_statusPageId_position_idx" ON "status_page_components"("statusPageId", "position");

-- CreateIndex
CREATE INDEX "status_page_components_monitorId_idx" ON "status_page_components"("monitorId");

-- CreateIndex
CREATE INDEX "status_page_incidents_statusPageId_startedAt_idx" ON "status_page_incidents"("statusPageId", "startedAt" DESC);

-- CreateIndex
CREATE INDEX "status_page_incident_updates_incidentId_createdAt_idx" ON "status_page_incident_updates"("incidentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_token_key" ON "status_page_subscribers"("token");

-- CreateIndex
CREATE INDEX "status_page_subscribers_statusPageId_status_idx" ON "status_page_subscribers"("statusPageId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "status_page_subscribers_statusPageId_email_key" ON "status_page_subscribers"("statusPageId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeCustomerId_key" ON "subscriptions"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_metric_periodStart_idx" ON "usage_records"("organizationId", "metric", "periodStart");

-- CreateIndex
CREATE INDEX "webhooks_organizationId_deletedAt_idx" ON "webhooks"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "webhook_deliveries_webhookId_createdAt_idx" ON "webhook_deliveries"("webhookId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sso_connections_domain_key" ON "sso_connections"("domain");

-- CreateIndex
CREATE INDEX "sso_connections_organizationId_deletedAt_idx" ON "sso_connections"("organizationId", "deletedAt");

-- CreateIndex
CREATE INDEX "_MaintenanceWindowToMonitor_B_index" ON "_MaintenanceWindowToMonitor"("B");

-- AddForeignKey
ALTER TABLE "monitor_groups" ADD CONSTRAINT "monitor_groups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "monitor_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_escalationPolicyId_fkey" FOREIGN KEY ("escalationPolicyId") REFERENCES "escalation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_assertions" ADD CONSTRAINT "monitor_assertions_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_windows" ADD CONSTRAINT "maintenance_windows_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_results" ADD CONSTRAINT "check_results_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_daily_stats" ADD CONSTRAINT "monitor_daily_stats_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_daily_stats" ADD CONSTRAINT "monitor_daily_stats_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_channels" ADD CONSTRAINT "alert_channels_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_channels" ADD CONSTRAINT "monitor_channels_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitor_channels" ADD CONSTRAINT "monitor_channels_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "alert_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "alert_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_policies" ADD CONSTRAINT "escalation_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_steps" ADD CONSTRAINT "escalation_steps_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "escalation_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_targets" ADD CONSTRAINT "escalation_targets_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "escalation_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_targets" ADD CONSTRAINT "escalation_targets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_targets" ADD CONSTRAINT "escalation_targets_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_targets" ADD CONSTRAINT "escalation_targets_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "alert_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_schedules" ADD CONSTRAINT "on_call_schedules_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_participants" ADD CONSTRAINT "on_call_participants_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_participants" ADD CONSTRAINT "on_call_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "on_call_overrides" ADD CONSTRAINT "on_call_overrides_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "on_call_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_pages" ADD CONSTRAINT "status_pages_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_components" ADD CONSTRAINT "status_page_components_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_components" ADD CONSTRAINT "status_page_components_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "monitors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_incidents" ADD CONSTRAINT "status_page_incidents_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_incident_updates" ADD CONSTRAINT "status_page_incident_updates_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "status_page_incidents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_page_subscribers" ADD CONSTRAINT "status_page_subscribers_statusPageId_fkey" FOREIGN KEY ("statusPageId") REFERENCES "status_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaintenanceWindowToMonitor" ADD CONSTRAINT "_MaintenanceWindowToMonitor_A_fkey" FOREIGN KEY ("A") REFERENCES "maintenance_windows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MaintenanceWindowToMonitor" ADD CONSTRAINT "_MaintenanceWindowToMonitor_B_fkey" FOREIGN KEY ("B") REFERENCES "monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
