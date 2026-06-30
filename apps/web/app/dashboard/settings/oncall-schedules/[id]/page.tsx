"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Radio, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { useActiveOrg, useMembers, type MemberRow } from "@/lib/queries";
import { hasPermission } from "@backend-uptime/shared";
import {
  useOnCallSchedule,
  useWhoIsOnCall,
  useOverrides,
  useAddOverride,
  useRemoveOverride,
  formatRotationType,
  formatHandoffTime,
  onCallSourceLabel,
  displayName,
  type OverrideInput,
  type OverrideView,
} from "@/lib/oncall-schedules";
import { formatDateTime } from "@/lib/format";

// ─── Add override modal ───────────────────────────────────────────────────────

interface OverrideModalProps {
  open: boolean;
  orgId: string;
  scheduleId: string;
  members: MemberRow[];
  onClose: () => void;
}

function AddOverrideModal({ open, orgId, scheduleId, members, onClose }: OverrideModalProps) {
  const { toast } = useToast();
  const addOverride = useAddOverride(orgId, scheduleId);

  const [userId, setUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit() {
    setFormError(null);
    if (!userId) {
      setFormError("Select who is covering.");
      return;
    }
    if (!startsAt || !endsAt) {
      setFormError("Start and end times are required.");
      return;
    }
    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (start >= end) {
      setFormError("End time must be after start time.");
      return;
    }

    const input: OverrideInput = {
      userId,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      reason: reason.trim() || undefined,
    };

    try {
      await addOverride.mutateAsync(input);
      toast("Override added.", "success");
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add override.");
    }
  }

  return (
    <Modal open={open} title="Add Override" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-muted">
          Temporarily reassign on-call duty — for a holiday swap, sick day, or any one-off change.
          Overrides take priority over the regular rotation.
        </p>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ov-user">Covering</Label>
          <Select id="ov-user" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Select a team member…</option>
            {members.map((m) => (
              <option key={m.user.id} value={m.user.id}>
                {m.user.name ?? m.user.email}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ov-start">Starts</Label>
            <input
              id="ov-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-text focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ov-end">Ends</Label>
            <input
              id="ov-end"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              className="h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-text focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ov-reason">Reason (optional)</Label>
          <Input
            id="ov-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Covering for Sam"
          />
        </div>

        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="flex justify-end gap-3 border-t border-line-soft pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={addOverride.isPending}>
            Add override
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnCallScheduleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const scheduleId = params.id;

  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "onCallSchedule", ["read"]) : false;
  const canUpdate = role ? hasPermission(role, "onCallSchedule", ["update"]) : false;

  const { data: schedule, isPending: schedulePending } = useOnCallSchedule(orgId, scheduleId);
  const { data: onCall, isPending: onCallPending } = useWhoIsOnCall(orgId, scheduleId, canRead);
  const { data: overridesData, isPending: overridesPending } = useOverrides(
    orgId,
    scheduleId,
    canRead,
  );
  const { data: membersData } = useMembers(orgId, true);

  const removeOverride = useRemoveOverride(orgId ?? "", scheduleId);
  const { toast } = useToast();

  const [addOverrideOpen, setAddOverrideOpen] = useState(false);
  const [toRemove, setToRemove] = useState<string | null>(null);

  const members: MemberRow[] = membersData?.items ?? [];
  const overrides: OverrideView[] = overridesData?.items ?? [];

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view this schedule.</Alert>;
  }

  async function onConfirmRemove() {
    if (!toRemove) return;
    try {
      await removeOverride.mutateAsync(toRemove);
      toast("Override removed.", "success");
      setToRemove(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not remove override.", "error");
    }
  }

  if (schedulePending) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!schedule) {
    return <Alert tone="error">Schedule not found.</Alert>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <button
          onClick={() => router.push("/dashboard/settings/oncall-schedules")}
          className="mb-3 flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text"
        >
          <ArrowLeft className="size-3.5" />
          Back to schedules
        </button>
        <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
          {schedule.name}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>{schedule.timezone}</span>
          <span className="text-muted/40">·</span>
          <span>{formatRotationType(schedule.rotationType)} rotation</span>
          <span className="text-muted/40">·</span>
          <span>Handoff at {formatHandoffTime(schedule.handoffMinute)}</span>
        </div>
      </div>

      {/* Who's on call now */}
      <Card className="p-5">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted">
          <Radio className="size-3.5" />
          On call right now
        </div>
        {onCallPending ? (
          <Skeleton className="mt-3 h-10 w-48" />
        ) : onCall && onCall.primary ? (
          <div className="mt-3 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-brand/15 text-sm font-semibold text-brand">
              {displayName(onCall.primary).slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="font-medium text-text">{displayName(onCall.primary)}</p>
              <p className="text-xs text-muted">{onCallSourceLabel(onCall.source)}</p>
            </div>
            {onCall.secondary && (
              <div className="ml-4 border-l border-line-soft pl-4">
                <p className="text-xs text-muted">Secondary</p>
                <p className="text-sm text-text">{displayName(onCall.secondary)}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-muted">No one is currently on call for this schedule.</p>
        )}
      </Card>

      {/* Rotation order */}
      <Card className="p-5">
        <h3 className="text-sm font-medium text-text">Rotation order</h3>
        <p className="mt-1 text-xs text-muted">
          Duty passes to the next person at {formatHandoffTime(schedule.handoffMinute)} (
          {schedule.timezone}).
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {[...schedule.participants]
            .sort((a, b) => a.position - b.position)
            .map((p, i) => (
              <div
                key={p.userId}
                className="flex items-center gap-3 rounded-md border border-line-soft bg-panel-2 px-3 py-2 text-sm"
              >
                <span className="w-5 shrink-0 text-center text-xs font-medium text-muted">
                  {i + 1}
                </span>
                <span className="text-text">{p.name ?? p.email ?? p.userId}</span>
              </div>
            ))}
        </div>
      </Card>

      {/* Overrides */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-text">Overrides</h3>
            <p className="mt-1 text-xs text-muted">
              One-off changes that take priority over the rotation.
            </p>
          </div>
          {canUpdate && (
            <Button size="sm" variant="secondary" onClick={() => setAddOverrideOpen(true)}>
              <Plus className="size-3.5" />
              Add override
            </Button>
          )}
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          {overridesPending ? (
            <Skeleton className="h-12 w-full" />
          ) : overrides.length === 0 ? (
            <p className="text-xs text-muted/50 italic">No overrides scheduled.</p>
          ) : (
            overrides.map((o) => {
              const member = members.find((m) => m.user.id === o.userId);
              return (
                <div
                  key={o.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line-soft bg-panel-2 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="text-text">
                      {member?.user.name ?? member?.user.email ?? o.userId}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDateTime(o.startsAt)} → {formatDateTime(o.endsAt)}
                      {o.reason ? ` · ${o.reason}` : ""}
                    </p>
                  </div>
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setToRemove(o.id)}
                      title="Remove override"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>

      {addOverrideOpen && orgId && (
        <AddOverrideModal
          open={addOverrideOpen}
          orgId={orgId}
          scheduleId={scheduleId}
          members={members}
          onClose={() => setAddOverrideOpen(false)}
        />
      )}

      <ConfirmDialog
        open={Boolean(toRemove)}
        title="Remove override?"
        description="The schedule will fall back to its regular rotation for this period."
        confirmLabel="Remove override"
        loading={removeOverride.isPending}
        onConfirm={onConfirmRemove}
        onCancel={() => setToRemove(null)}
      />
    </div>
  );
}
