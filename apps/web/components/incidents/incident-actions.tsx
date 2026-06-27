"use client";

import { useState } from "react";
import { Check, CircleCheck, ExternalLink, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import {
  useAcknowledgeIncident,
  useResolveIncident,
  type IncidentDetail,
} from "@/lib/incidents";
import { useToggleMonitorState } from "@/lib/monitors";

export interface IncidentActionsProps {
  orgId: string;
  incident: IncidentDetail;
  canManage: boolean;
}

/**
 * Action bar for an incident: acknowledge, resolve, plus monitor-level controls
 * (pause / open). Reopen and manual retry-check are intentionally absent — the
 * backend exposes no endpoint for either.
 */
export function IncidentActions({ orgId, incident, canManage }: IncidentActionsProps) {
  const acknowledge = useAcknowledgeIncident(orgId, incident.id);
  const resolve = useResolveIncident(orgId, incident.id);
  const toggleMonitor = useToggleMonitorState(orgId);
  const { toast } = useToast();
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);

  async function onAcknowledge() {
    try {
      await acknowledge.mutateAsync();
      toast("Incident acknowledged.", "success");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not acknowledge.", "error");
    }
  }

  async function onResolve() {
    try {
      await resolve.mutateAsync();
      toast("Incident resolved.", "success");
      setConfirmResolve(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not resolve.", "error");
    }
  }

  async function onPauseMonitor() {
    if (!incident.monitorId) return;
    try {
      await toggleMonitor.mutateAsync({ id: incident.monitorId, action: "pause" });
      toast("Monitor paused.", "success");
      setConfirmPause(false);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not pause monitor.", "error");
    }
  }

  const isResolved = incident.status === "RESOLVED";

  if (!canManage) {
    return incident.monitorId ? (
      <ButtonLink
        href={`/dashboard/monitors/${incident.monitorId}`}
        variant="secondary"
        size="sm"
      >
        <ExternalLink className="size-3.5" /> Open monitor
      </ButtonLink>
    ) : null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {incident.status === "OPEN" ? (
        <Button size="sm" onClick={onAcknowledge} loading={acknowledge.isPending}>
          <Check className="size-3.5" /> Acknowledge
        </Button>
      ) : null}
      {!isResolved ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirmResolve(true)}
        >
          <CircleCheck className="size-3.5" /> Resolve
        </Button>
      ) : null}
      {incident.monitorId ? (
        <>
          {!isResolved ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmPause(true)}
            >
              <Pause className="size-3.5" /> Pause monitor
            </Button>
          ) : null}
          <ButtonLink
            href={`/dashboard/monitors/${incident.monitorId}`}
            variant="ghost"
            size="sm"
          >
            <ExternalLink className="size-3.5" /> Open monitor
          </ButtonLink>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmResolve}
        title="Resolve incident?"
        description="This marks the incident resolved and records a recovery event on the timeline."
        confirmLabel="Resolve"
        tone="primary"
        loading={resolve.isPending}
        onConfirm={onResolve}
        onCancel={() => setConfirmResolve(false)}
      />
      <ConfirmDialog
        open={confirmPause}
        title="Pause the affected monitor?"
        description="Checks stop until you resume it. Use this to silence a noisy monitor while you investigate."
        confirmLabel="Pause monitor"
        loading={toggleMonitor.isPending}
        onConfirm={onPauseMonitor}
        onCancel={() => setConfirmPause(false)}
      />
    </div>
  );
}
