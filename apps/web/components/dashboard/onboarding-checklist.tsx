"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  CheckCircle2,
  Circle,
  Globe2,
  LayoutPanelTop,
  Radar,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Card } from "@/components/ui/card";
import { useAlertChannels, useMonitors } from "@/lib/monitors";
import { useMembers } from "@/lib/queries";
import { useStatusPages } from "@/lib/status-pages";
import { cn } from "@/lib/utils";

interface OnboardingChecklistProps {
  orgId: string | undefined;
  canManage: boolean;
}

const ONBOARDING_DISMISS_KEY = "uptimeflow:onboarding-dismissed";

export function OnboardingChecklist({ orgId, canManage }: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const monitorsQuery = useMonitors(orgId, Boolean(orgId));
  const channelsQuery = useAlertChannels(orgId, Boolean(orgId));
  const statusPagesQuery = useStatusPages(orgId, Boolean(orgId));
  const membersQuery = useMembers(orgId, Boolean(orgId));

  useEffect(() => {
    const stored = window.localStorage.getItem(ONBOARDING_DISMISS_KEY);
    if (stored === "1") setDismissed(true);
    setHydrated(true);
  }, []);

  function onDismiss() {
    setDismissed(true);
    window.localStorage.setItem(ONBOARDING_DISMISS_KEY, "1");
  }

  if (!hydrated || dismissed) return null;

  const hasMonitors = (monitorsQuery.data?.items.length ?? 0) > 0;
  const hasChannels = (channelsQuery.data?.items.length ?? 0) > 0;
  const hasStatusPages = (statusPagesQuery.data?.items.length ?? 0) > 0;
  const hasMembers = (membersQuery.data?.items.length ?? 0) > 1;

  const steps = [
    {
      id: "monitor",
      label: "Create your first monitor",
      description: "Set up HTTP, Ping, SSL, or TCP synthetic checks with sub-minute intervals.",
      icon: Radar,
      href: "/dashboard/monitors/new",
      actionText: "New monitor",
      completed: hasMonitors,
    },
    {
      id: "alerts",
      label: "Connect an alert channel",
      description: "Receive instant outage notifications via Slack, Discord, Email, Webhooks, or SMS.",
      icon: BellRing,
      href: "/dashboard/settings/alert-channels",
      actionText: "Add channel",
      completed: hasChannels,
    },
    {
      id: "status-page",
      label: "Launch a public status page",
      description: "Communicate real-time reliability and historical uptime under your own domain.",
      icon: LayoutPanelTop,
      href: "/dashboard/status-pages",
      actionText: "Status pages",
      completed: hasStatusPages,
    },
    {
      id: "team",
      label: "Invite team members",
      description: "Collaborate on incident response, on-call schedules, and infrastructure health.",
      icon: Users,
      href: "/dashboard/settings/members",
      actionText: "Invite team",
      completed: hasMembers,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progressPct = (completedCount / steps.length) * 100;
  const allDone = completedCount === steps.length;

  // Don't clutter the UI if user has already accomplished all 4 steps
  if (allDone) return null;

  return (
    <Card className="relative overflow-hidden border-brand/30 bg-gradient-to-br from-panel via-panel to-brand/5 p-6 shadow-lg">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-full bg-brand/20 text-brand">
              <Sparkles className="size-3.5" />
            </span>
            <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-text">
              Quick Setup Guide
            </h2>
            <span className="rounded-full border border-brand/40 bg-brand/10 px-2 py-0.5 font-[family-name:var(--font-mono)] text-[11px] font-medium text-brand">
              {completedCount} of {steps.length} complete
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">
            Get your production observability fully operational in under 3 minutes.
          </p>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          title="Dismiss setup guide"
          aria-label="Dismiss setup guide"
          className="rounded p-1 text-muted transition-colors hover:bg-panel-2 hover:text-text"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* Progress Bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
        <div
          className="h-full bg-brand transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {/* Checklist Grid */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div
              key={step.id}
              className={cn(
                "flex flex-col justify-between rounded-lg border p-4 transition-colors",
                step.completed
                  ? "border-line-soft bg-panel-2/40 opacity-75"
                  : "border-line bg-panel-2 hover:border-brand/40",
              )}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0">
                  {step.completed ? (
                    <CheckCircle2 className="size-4 text-up" />
                  ) : (
                    <Circle className="size-4 text-muted/60" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 font-medium text-sm text-text">
                    <Icon className="size-3.5 text-muted shrink-0" />
                    <span className={cn(step.completed && "line-through text-muted")}>
                      {step.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    {step.description}
                  </p>
                </div>
              </div>

              {!step.completed && canManage ? (
                <div className="mt-3.5 flex justify-end">
                  <ButtonLink
                    href={step.href}
                    variant="secondary"
                    size="sm"
                    className="gap-1.5 text-xs"
                  >
                    {step.actionText} <ArrowRight className="size-3" />
                  </ButtonLink>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
