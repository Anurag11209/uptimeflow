"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Edit, GitMerge, GripVertical, Plus, Trash2 } from "lucide-react";
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
  useEscalationPolicies,
  useEscalationPolicy,
  useCreateEscalationPolicy,
  useUpdateEscalationPolicy,
  useDeleteEscalationPolicy,
  formatDelay,
  formatRepeat,
  stepLabel,
  type EscalationPolicyListItem,
  type EscalationStep,
  type EscalationStepInput,
  type EscalationTarget,
  type EscalationTargetInput,
  type UpsertEscalationPolicyInput,
} from "@/lib/escalation-policies";
import { useAlertChannels, formatChannelType, type AlertChannelItem } from "@/lib/alert-channels";
import { formatDateTime } from "@/lib/format";

// ─── Step builder ─────────────────────────────────────────────────────────────

interface StepBuilderProps {
  step: EscalationStepInput;
  position: number;
  members: MemberRow[];
  channelItems: { id: string; name: string; type: string }[];
  onChange: (step: EscalationStepInput) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function StepBuilder({
  step,
  position,
  members,
  channelItems,
  onChange,
  onRemove,
  canRemove,
}: StepBuilderProps) {
  function addTarget(target: EscalationTargetInput) {
    onChange({ ...step, targets: [...step.targets, target] });
  }

  function removeTarget(index: number) {
    onChange({ ...step, targets: step.targets.filter((_, i) => i !== index) });
  }

  return (
    <div className="rounded-md border border-line bg-panel p-4 space-y-4">
      {/* Step header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="size-4 text-muted/30" />
          <span className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-muted">
            {stepLabel(position)}
          </span>
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-1 text-muted transition-colors hover:bg-panel-2 hover:text-text"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>

      {/* Delay */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-xs text-muted">Wait</span>
        <Select
          value={String(step.delayMinutes)}
          onChange={(e) => onChange({ ...step, delayMinutes: Number(e.target.value) })}
          className="w-44"
        >
          <option value="0">Immediately</option>
          <option value="5">5 minutes</option>
          <option value="10">10 minutes</option>
          <option value="15">15 minutes</option>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="120">2 hours</option>
          <option value="240">4 hours</option>
        </Select>
        <span className="text-xs text-muted">then notify</span>
      </div>

      {/* Targets */}
      <div className="space-y-2">
        {step.targets.length === 0 ? (
          <p className="text-xs text-muted/50 italic">No targets yet.</p>
        ) : (
          step.targets.map((t, i) => {
            const isUser = t.type === "USER";
            const label = isUser
              ? (members.find((m) => m.user.id === t.userId)?.user.name ??
                members.find((m) => m.user.id === t.userId)?.user.email ??
                t.userId ??
                "Unknown user")
              : (channelItems.find((c) => c.id === t.channelId)?.name ??
                t.channelId ??
                "Unknown channel");

            return (
              <div
                key={i}
                className="flex items-center justify-between gap-2 rounded border border-line-soft bg-panel-2 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Badge tone="muted">{isUser ? "User" : "Channel"}</Badge>
                  <span className="text-text truncate">{label}</span>
                </div>
                <button
                  type="button"
                  onClick={() => removeTarget(i)}
                  className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-panel hover:text-text"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            );
          })
        )}

        {/* Add target dropdown */}
        <Select
          value=""
          onChange={(e) => {
            const val = e.target.value;
            if (!val) return;
            const colonIdx = val.indexOf(":");
            const kind = val.slice(0, colonIdx);
            const id = val.slice(colonIdx + 1);
            if (kind === "user") addTarget({ type: "USER", userId: id });
            else addTarget({ type: "CHANNEL", channelId: id });
            e.target.value = "";
          }}
          className="text-sm text-muted"
        >
          <option value="">+ Add target…</option>
          {members.length > 0 && (
            <optgroup label="Team members">
              {members.map((m) => (
                <option key={m.user.id} value={`user:${m.user.id}`}>
                  {m.user.name ?? m.user.email}
                </option>
              ))}
            </optgroup>
          )}
          {channelItems.length > 0 && (
            <optgroup label="Alert channels">
              {channelItems.map((c) => (
                <option key={c.id} value={`channel:${c.id}`}>
                  {c.name} ({formatChannelType(c.type as never)})
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
    </div>
  );
}

// ─── Policy modal ─────────────────────────────────────────────────────────────

interface PolicyModalProps {
  open: boolean;
  editingId: string | null;
  orgId: string;
  onClose: () => void;
}

const BLANK_STEP: EscalationStepInput = { delayMinutes: 0, targets: [] };

function PolicyModal({ open, editingId, orgId, onClose }: PolicyModalProps) {
  const { toast } = useToast();
  const isEditing = Boolean(editingId);

  const { data: detail, isPending: loadingDetail } = useEscalationPolicy(
    orgId,
    editingId ?? undefined,
  );
  const createPolicy = useCreateEscalationPolicy(orgId);
  const updatePolicy = useUpdateEscalationPolicy(orgId);

  const { data: membersData } = useMembers(orgId, true);
  const { data: channelsData } = useAlertChannels(orgId, true);
  const members: MemberRow[] = membersData?.items ?? [];
  const channelItems = (channelsData?.items ?? []).map((c: AlertChannelItem) => ({
    id: c.id,
    name: c.name,
    type: c.type,
  }));

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repeatCount, setRepeatCount] = useState(0);
  const [steps, setSteps] = useState<EscalationStepInput[]>([{ ...BLANK_STEP }]);
  const [expanded, setExpanded] = useState<number | null>(0);
  const [formError, setFormError] = useState<string | null>(null);

  // Populate form when editing detail loads
  useEffect(() => {
    if (detail && editingId) {
      setName(detail.name);
      setDescription(detail.description ?? "");
      setRepeatCount(detail.repeatCount);
      setExpanded(0);
      setSteps(
        detail.steps.map((s: EscalationStep) => ({
          delayMinutes: s.delayMinutes,
          targets: s.targets.map((t: EscalationTarget) => ({
            type: t.type,
            userId: t.userId ?? undefined,
            scheduleId: t.scheduleId ?? undefined,
            channelId: t.channelId ?? undefined,
          })),
        })),
      );
    } else if (!editingId) {
      setName("");
      setDescription("");
      setRepeatCount(0);
      setSteps([{ ...BLANK_STEP }]);
      setExpanded(0);
    }
  }, [detail, editingId]);

  function addStep() {
    const next = steps.length;
    setSteps((prev) => [...prev, { ...BLANK_STEP }]);
    setExpanded(next);
  }

  function removeStep(index: number) {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setExpanded(null);
  }

  function updateStep(index: number, step: EscalationStepInput) {
    setSteps((prev) => prev.map((s, i) => (i === index ? step : s)));
  }

  async function onSubmit() {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (steps.some((s) => s.targets.length === 0)) {
      setFormError("Every step needs at least one target.");
      return;
    }

    const input: UpsertEscalationPolicyInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      repeatCount,
      steps,
    };

    try {
      if (editingId) {
        await updatePolicy.mutateAsync({ id: editingId, input });
        toast("Escalation policy updated.", "success");
      } else {
        await createPolicy.mutateAsync(input);
        toast("Escalation policy created.", "success");
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save escalation policy.");
    }
  }

  const isPending = createPolicy.isPending || updatePolicy.isPending;

  // While loading the detail for edit, show a minimal loading state
  if (isEditing && loadingDetail) {
    return (
      <Modal open={open} title="Edit Escalation Policy" onClose={onClose}>
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-muted">Loading…</p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title={isEditing ? "Edit Escalation Policy" : "New Escalation Policy"}
      onClose={onClose}
      className="max-w-xl"
    >
      <div className="flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ep-name">Name</Label>
          <Input
            id="ep-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Production Critical"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ep-desc">
            Description <span className="text-muted font-normal">(optional)</span>
          </Label>
          <textarea
            id="ep-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="When should this policy be used?"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted/40 focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 resize-none"
          />
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <Label>Escalation steps</Label>
            <span className="text-xs text-muted">{steps.length} / 20</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <div key={i}>
                {/* Collapsed header */}
                <button
                  type="button"
                  onClick={() => setExpanded(expanded === i ? null : i)}
                  className="flex w-full items-center justify-between rounded-md border border-line bg-panel-2 px-3 py-2.5 text-sm hover:bg-panel transition-colors"
                >
                  <span className="font-medium text-text">{stepLabel(i)}</span>
                  <div className="flex items-center gap-3 text-muted">
                    <span className="text-xs">{formatDelay(step.delayMinutes)}</span>
                    <span className="text-xs text-muted/40">·</span>
                    <span className="text-xs">
                      {step.targets.length} target{step.targets.length !== 1 ? "s" : ""}
                    </span>
                    {expanded === i ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </div>
                </button>

                {expanded === i && (
                  <div className="mt-1">
                    <StepBuilder
                      step={step}
                      position={i}
                      members={members}
                      channelItems={channelItems}
                      onChange={(s) => updateStep(i, s)}
                      onRemove={() => removeStep(i)}
                      canRemove={steps.length > 1}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>

          {steps.length < 20 && (
            <Button variant="secondary" size="sm" onClick={addStep} className="self-start mt-1">
              <Plus className="size-3.5" />
              Add step
            </Button>
          )}
        </div>

        {/* Repeat */}
        <div className="flex items-center gap-4 rounded-md border border-line bg-panel-2 px-4 py-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-text">Repeat if unacknowledged</p>
            <p className="text-xs text-muted mt-0.5">
              Restart the policy from the beginning after all steps complete.
            </p>
          </div>
          <Select
            value={String(repeatCount)}
            onChange={(e) => setRepeatCount(Number(e.target.value))}
            className="w-36 shrink-0"
          >
            <option value="0">No repeat</option>
            <option value="1">Once</option>
            <option value="2">Twice</option>
            <option value="3">3 times</option>
            <option value="5">5 times</option>
          </Select>
        </div>

        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="flex justify-end gap-3 border-t border-line-soft pt-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={isPending}>
            {isEditing ? "Save changes" : "Create policy"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function EscalationPoliciesPage() {
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "escalationPolicy", ["read"]) : false;
  const canCreate = role ? hasPermission(role, "escalationPolicy", ["create"]) : false;
  const canUpdate = role ? hasPermission(role, "escalationPolicy", ["update"]) : false;
  const canDelete = role ? hasPermission(role, "escalationPolicy", ["delete"]) : false;

  const { data, isPending } = useEscalationPolicies(orgId, canRead);
  const deletePolicy = useDeleteEscalationPolicy(orgId ?? "");
  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<EscalationPolicyListItem | null>(null);

  const allPolicies: EscalationPolicyListItem[] = data?.items ?? [];

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view escalation policies.</Alert>;
  }

  async function onDelete() {
    if (!toDelete || !orgId) return;
    try {
      await deletePolicy.mutateAsync(toDelete.id);
      toast("Escalation policy deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete policy.", "error");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
            Escalation Policies
          </h2>
          <p className="mt-1 text-sm text-muted">
            Define who gets notified and when if an incident is not acknowledged.
          </p>
        </div>
        {canCreate && (
          <Button
            size="sm"
            onClick={() => {
              setEditingId(null);
              setModalOpen(true);
            }}
          >
            <Plus className="size-4" />
            New policy
          </Button>
        )}
      </div>

      {/* List */}
      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : allPolicies.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <GitMerge className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">No escalation policies yet</p>
          <p className="max-w-sm text-sm text-muted">
            Create a policy to chain notifications — first alert on-call, then a manager, then a
            Slack channel — until someone acknowledges.
          </p>
          {canCreate && (
            <Button
              size="sm"
              className="mt-1"
              onClick={() => {
                setEditingId(null);
                setModalOpen(true);
              }}
            >
              <Plus className="size-4" />
              New policy
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line-soft text-left">
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Name
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Steps
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Repeat
                </th>
                <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                  Created
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {allPolicies.map((policy) => (
                <tr key={policy.id} className="group hover:bg-panel-2/50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-text">{policy.name}</p>
                    {policy.description && (
                      <p className="mt-0.5 text-xs text-muted line-clamp-1">{policy.description}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone="muted">
                      {policy.stepCount} step{policy.stepCount !== 1 ? "s" : ""}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatRepeat(policy.repeatCount)}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">
                    {formatDateTime(policy.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      {canUpdate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Edit"
                          onClick={() => {
                            setEditingId(policy.id);
                            setModalOpen(true);
                          }}
                        >
                          <Edit className="size-3.5" />
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="danger"
                          size="sm"
                          title="Delete"
                          onClick={() => setToDelete(policy)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {modalOpen && orgId && (
        <PolicyModal
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
        title="Delete escalation policy?"
        description={
          toDelete
            ? `Delete "${toDelete.name}"? Monitors using this policy will stop escalating.`
            : undefined
        }
        confirmLabel="Delete policy"
        loading={deletePolicy.isPending}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
