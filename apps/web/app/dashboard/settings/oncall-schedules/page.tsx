"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarClock, Edit, Plus, Trash2, Users as UsersIcon } from "lucide-react";
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
  useOnCallSchedules,
  useOnCallSchedule,
  useCreateOnCallSchedule,
  useUpdateOnCallSchedule,
  useDeleteOnCallSchedule,
  formatRotationType,
  formatHandoffTime,
  parseHandoffTime,
  defaultTimezone,
  COMMON_TIMEZONES,
  type ScheduleListItem,
  type RotationType,
  type UpsertScheduleInput,
} from "@/lib/oncall-schedules";
import { formatDateTime } from "@/lib/format";

const ROTATION_TYPES: RotationType[] = ["DAILY", "WEEKLY", "BIWEEKLY", "CUSTOM"];

// ─── Schedule modal (create / edit) ───────────────────────────────────────────

interface ScheduleModalProps {
  open: boolean;
  editingId: string | null;
  orgId: string;
  onClose: () => void;
}

function ScheduleModal({ open, editingId, orgId, onClose }: ScheduleModalProps) {
  const { toast } = useToast();
  const isEditing = Boolean(editingId);

  const { data: detail, isPending: loadingDetail } = useOnCallSchedule(
    orgId,
    editingId ?? undefined,
  );
  const { data: membersData } = useMembers(orgId, true);
  const members: MemberRow[] = membersData?.items ?? [];

  const createSchedule = useCreateOnCallSchedule(orgId);
  const updateSchedule = useUpdateOnCallSchedule(orgId);

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(defaultTimezone());
  const [rotationType, setRotationType] = useState<RotationType>("WEEKLY");
  const [handoffTime, setHandoffTime] = useState("09:00");
  // Ordered list of participant user ids — order defines rotation sequence
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  // Populate when editing an existing schedule
  if (detail && editingId && name === "" && !loadingDetail) {
    // Lazy one-time hydrate guarded by name==="" to avoid clobbering edits
    setName(detail.name);
    setTimezone(detail.timezone);
    setRotationType(detail.rotationType);
    setHandoffTime(formatHandoffTime(detail.handoffMinute));
    setParticipantIds(
      [...detail.participants].sort((a, b) => a.position - b.position).map((p) => p.userId),
    );
  }

  function resetForBlankCreate() {
    setName("");
    setTimezone(defaultTimezone());
    setRotationType("WEEKLY");
    setHandoffTime("09:00");
    setParticipantIds([]);
    setFormError(null);
  }

  function addParticipant(userId: string) {
    if (!userId || participantIds.includes(userId)) return;
    setParticipantIds((prev) => [...prev, userId]);
  }

  function removeParticipant(userId: string) {
    setParticipantIds((prev) => prev.filter((id) => id !== userId));
  }

  function moveParticipant(index: number, direction: -1 | 1) {
    setParticipantIds((prev) => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      const a = next[index];
      const b = next[target];
      if (a === undefined || b === undefined) return prev;
      next[index] = b;
      next[target] = a;
      return next;
    });
  }

  async function onSubmit() {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (participantIds.length === 0) {
      setFormError("Add at least one participant.");
      return;
    }

    const input: UpsertScheduleInput = {
      name: name.trim(),
      timezone,
      rotationType,
      handoffMinute: parseHandoffTime(handoffTime),
      participants: participantIds,
    };

    try {
      if (editingId) {
        await updateSchedule.mutateAsync({ id: editingId, input });
        toast("Schedule updated.", "success");
      } else {
        await createSchedule.mutateAsync(input);
        toast("Schedule created.", "success");
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save schedule.");
    }
  }

  const isPending = createSchedule.isPending || updateSchedule.isPending;

  if (isEditing && loadingDetail) {
    return (
      <Modal open={open} title="Edit Schedule" onClose={onClose}>
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={isEditing ? "Edit On-call Schedule" : "New On-call Schedule"}
      onClose={() => {
        if (!isEditing) resetForBlankCreate();
        onClose();
      }}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oc-name">Name</Label>
          <Input
            id="oc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Primary On-call"
          />
        </div>

        {/* Timezone + Rotation */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oc-tz">Timezone</Label>
            <Select id="oc-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {!COMMON_TIMEZONES.includes(timezone) && <option value={timezone}>{timezone}</option>}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="oc-rotation">Rotation</Label>
            <Select
              id="oc-rotation"
              value={rotationType}
              onChange={(e) => setRotationType(e.target.value as RotationType)}
            >
              {ROTATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {formatRotationType(t)}
                </option>
              ))}
            </Select>
            {rotationType === "CUSTOM" && (
              <p className="text-xs text-amber-500">
                Custom intervals aren&apos;t implemented yet — this behaves the same as Weekly.
              </p>
            )}
          </div>
        </div>

        {/* Handoff time */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="oc-handoff">Handoff time</Label>
          <input
            id="oc-handoff"
            type="time"
            value={handoffTime}
            onChange={(e) => setHandoffTime(e.target.value)}
            className="h-10 w-40 rounded-md border border-line bg-panel-2 px-3 text-sm text-text focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
          />
          <p className="text-xs text-muted">
            Time of day (in the schedule&apos;s timezone) when on-call duty passes to the next
            person.
          </p>
        </div>

        {/* Participants — ordered rotation list */}
        <div className="flex flex-col gap-2">
          <Label>Rotation order</Label>
          <p className="text-xs text-muted">
            Participants rotate in this order. Use the arrows to reorder.
          </p>

          {participantIds.length === 0 ? (
            <p className="text-xs text-muted/50 italic">No participants added yet.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {participantIds.map((userId, i) => {
                const member = members.find((m) => m.user.id === userId);
                const label = member?.user.name ?? member?.user.email ?? userId;
                return (
                  <div
                    key={userId}
                    className="flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm"
                  >
                    <span className="w-5 shrink-0 text-center text-xs font-medium text-muted">
                      {i + 1}
                    </span>
                    <span className="flex-1 truncate text-text">{label}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={i === 0}
                        onClick={() => moveParticipant(i, -1)}
                        className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Move up"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={i === participantIds.length - 1}
                        onClick={() => moveParticipant(i, 1)}
                        className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text disabled:opacity-30 disabled:hover:bg-transparent"
                        aria-label="Move down"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeParticipant(userId)}
                        className="rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text"
                        aria-label="Remove"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <Select
            value=""
            onChange={(e) => {
              addParticipant(e.target.value);
              e.target.value = "";
            }}
            className="text-sm text-muted"
          >
            <option value="">+ Add participant…</option>
            {members
              .filter((m) => !participantIds.includes(m.user.id))
              .map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.name ?? m.user.email}
                </option>
              ))}
          </Select>
        </div>

        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="flex justify-end gap-3 border-t border-line-soft pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={isPending}>
            {isEditing ? "Save changes" : "Create schedule"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnCallSchedulesPage() {
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "onCallSchedule", ["read"]) : false;
  const canCreate = role ? hasPermission(role, "onCallSchedule", ["create"]) : false;
  const canUpdate = role ? hasPermission(role, "onCallSchedule", ["update"]) : false;
  const canDelete = role ? hasPermission(role, "onCallSchedule", ["delete"]) : false;

  const { data, isPending } = useOnCallSchedules(orgId, canRead);
  const deleteSchedule = useDeleteOnCallSchedule(orgId ?? "");
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalKey, setModalKey] = useState(0); // forces remount to reset hydrate guard
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ScheduleListItem | null>(null);

  const allSchedules: ScheduleListItem[] = data?.items ?? [];

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view on-call schedules.</Alert>;
  }

  function openCreate() {
    setEditingId(null);
    setModalKey((k) => k + 1);
    setModalOpen(true);
  }

  function openEdit(schedule: ScheduleListItem) {
    setEditingId(schedule.id);
    setModalKey((k) => k + 1);
    setModalOpen(true);
  }

  async function onDelete() {
    if (!toDelete) return;
    try {
      await deleteSchedule.mutateAsync(toDelete.id);
      toast("Schedule deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete schedule.", "error");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
            On-call Schedules
          </h2>
          <p className="mt-1 text-sm text-muted">
            Rotate who is on duty. Attach a schedule as an escalation target to page whoever is
            currently on call.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New schedule
          </Button>
        )}
      </div>

      {/* List */}
      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : allSchedules.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <CalendarClock className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">No on-call schedules yet</p>
          <p className="max-w-sm text-sm text-muted">
            Create a schedule to rotate on-call duty across your team, with optional one-off
            overrides for holidays or swaps.
          </p>
          {canCreate && (
            <Button size="sm" className="mt-1" onClick={openCreate}>
              <Plus className="size-4" />
              New schedule
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {allSchedules.map((schedule) => (
            <Card key={schedule.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/dashboard/settings/oncall-schedules/${schedule.id}`}
                    className="font-medium text-text hover:text-brand transition-colors"
                  >
                    {schedule.name}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted">{schedule.timezone}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      title="Edit"
                      onClick={() => openEdit(schedule)}
                    >
                      <Edit className="size-3.5" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button
                      variant="danger"
                      size="sm"
                      title="Delete"
                      onClick={() => setToDelete(schedule)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="muted">{formatRotationType(schedule.rotationType)}</Badge>
                <Badge tone="muted">
                  <UsersIcon className="size-3" />
                  {schedule.participantCount}
                </Badge>
                <span className="text-xs text-muted">
                  Handoff {formatHandoffTime(schedule.handoffMinute)}
                </span>
              </div>

              <p className="text-xs text-muted/70">Created {formatDateTime(schedule.createdAt)}</p>
            </Card>
          ))}
        </div>
      )}

      {modalOpen && orgId && (
        <ScheduleModal
          key={modalKey}
          open={modalOpen}
          editingId={editingId}
          orgId={orgId}
          onClose={() => {
            setModalOpen(false);
            setEditingId(null);
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete on-call schedule?"
        description={
          toDelete
            ? `Delete "${toDelete.name}"? Escalation policies pointing to it will no longer resolve.`
            : undefined
        }
        confirmLabel="Delete schedule"
        loading={deleteSchedule.isPending}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
