"use client";

import { useEffect, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
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
import { useMonitors } from "@/lib/monitors";
import {
  COMPONENT_STATUSES,
  componentStatusLabel,
  componentStatusMeta,
  useCreateComponent,
  useDeleteComponent,
  useReorderComponents,
  useStatusPageComponents,
  useUpdateComponent,
  type ComponentStatus,
  type StatusComponent,
} from "@/lib/status-pages";

interface ComponentDraft {
  name: string;
  groupName: string;
  description: string;
  status: ComponentStatus;
  monitorId: string;
  showUptime: boolean;
}

function draftFrom(c?: StatusComponent): ComponentDraft {
  return {
    name: c?.name ?? "",
    groupName: c?.groupName ?? "",
    description: c?.description ?? "",
    status: c?.status ?? "OPERATIONAL",
    monitorId: c?.monitorId ?? "",
    showUptime: c?.showUptime ?? true,
  };
}

export function ComponentsTab({
  orgId,
  pageId,
  canManage,
}: {
  orgId: string;
  pageId: string;
  canManage: boolean;
}) {
  const { data, isPending, error } = useStatusPageComponents(orgId, pageId);
  const monitors = useMonitors(orgId, canManage);
  const createComponent = useCreateComponent(orgId, pageId);
  const updateComponent = useUpdateComponent(orgId, pageId);
  const deleteComponent = useDeleteComponent(orgId, pageId);
  const reorder = useReorderComponents(orgId, pageId);
  const { toast } = useToast();

  // Local ordering mirror so drag feels instant; resynced when server data lands.
  const [order, setOrder] = useState<StatusComponent[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [editing, setEditing] = useState<StatusComponent | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<ComponentDraft>(draftFrom());
  const [toDelete, setToDelete] = useState<StatusComponent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.items) setOrder(data.items);
  }, [data]);

  function openCreate() {
    setDraft(draftFrom());
    setFormError(null);
    setCreating(true);
  }

  function openEdit(c: StatusComponent) {
    setDraft(draftFrom(c));
    setFormError(null);
    setEditing(c);
  }

  async function onChangeStatus(c: StatusComponent, status: ComponentStatus) {
    try {
      await updateComponent.mutateAsync({ id: c.id, payload: { status } });
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update component.", "error");
    }
  }

  async function onSubmitDraft() {
    if (!draft.name.trim()) {
      setFormError("Name is required.");
      return;
    }
    const payload = {
      name: draft.name.trim(),
      groupName: draft.groupName.trim() || null,
      description: draft.description.trim() || null,
      status: draft.status,
      monitorId: draft.monitorId || null,
      showUptime: draft.showUptime,
    };
    try {
      if (editing) {
        await updateComponent.mutateAsync({ id: editing.id, payload });
        toast("Component updated.", "success");
        setEditing(null);
      } else {
        await createComponent.mutateAsync(payload);
        toast("Component added.", "success");
        setCreating(false);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save component.");
    }
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    try {
      await deleteComponent.mutateAsync(toDelete.id);
      toast("Component deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete component.", "error");
    }
  }

  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) return;
    const ids = order.map((c) => c.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    if (!moved) return;
    next.splice(to, 0, moved);
    setOrder(next);
    setDragId(null);
    reorder.mutate(
      next.map((c) => c.id),
      {
        onError: (err) =>
          toast(err instanceof ApiError ? err.message : "Could not reorder.", "error"),
      },
    );
  }

  if (isPending) {
    return (
      <Card className="divide-y divide-line-soft">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="size-5" />
            <Skeleton className="h-5 flex-1" />
            <Skeleton className="h-5 w-32" />
          </div>
        ))}
      </Card>
    );
  }

  if (error) {
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : "Could not load components."}
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {order.length} component{order.length === 1 ? "" : "s"}
          {canManage && order.length > 1 ? " · drag to reorder" : ""}
        </p>
        {canManage ? (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" /> Add component
          </Button>
        ) : null}
      </div>

      {order.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 px-6 py-12 text-center">
          <p className="text-sm font-medium text-text">No components yet</p>
          <p className="max-w-xs text-xs text-muted">
            Components are the services shown on your public page. Link one to a monitor to drive its
            status automatically.
          </p>
          {canManage ? (
            <Button size="sm" className="mt-1" onClick={openCreate}>
              <Plus className="size-4" /> Add component
            </Button>
          ) : null}
        </Card>
      ) : (
        <Card className="divide-y divide-line-soft">
          {order.map((c) => {
            const meta = componentStatusMeta(c.status);
            return (
              <div
                key={c.id}
                draggable={canManage}
                onDragStart={() => setDragId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(c.id)}
                className={`flex items-center gap-3 p-4 ${dragId === c.id ? "opacity-50" : ""}`}
              >
                {canManage ? (
                  <GripVertical
                    className="size-4 shrink-0 cursor-grab text-muted active:cursor-grabbing"
                    aria-hidden
                  />
                ) : (
                  <span className={`size-2 shrink-0 rounded-full ${meta.dot}`} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{c.name}</span>
                    {c.groupName ? <Badge tone="muted">{c.groupName}</Badge> : null}
                    {c.monitorId ? <Badge tone="brand">Auto</Badge> : null}
                  </div>
                  {c.description ? (
                    <p className="truncate text-xs text-muted">{c.description}</p>
                  ) : null}
                </div>

                {canManage && !c.monitorId ? (
                  <div className="w-48 shrink-0">
                    <Select
                      value={c.status}
                      onChange={(e) => onChangeStatus(c, e.target.value as ComponentStatus)}
                      aria-label={`Status for ${c.name}`}
                    >
                      {COMPONENT_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {componentStatusLabel(s)}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : (
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                )}

                {canManage ? (
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(c)}
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => setToDelete(c)}
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </Card>
      )}

      <Modal
        open={creating || editing !== null}
        title={editing ? "Edit component" : "Add component"}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name">Name</Label>
            <Input
              id="c-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="API"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-group">Group</Label>
              <Input
                id="c-group"
                value={draft.groupName}
                onChange={(e) => setDraft((d) => ({ ...d, groupName: e.target.value }))}
                placeholder="Core services"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-monitor">Linked monitor</Label>
              <Select
                id="c-monitor"
                value={draft.monitorId}
                onChange={(e) => setDraft((d) => ({ ...d, monitorId: e.target.value }))}
              >
                <option value="">Manual status</option>
                {(monitors.data?.items ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-desc">Description</Label>
            <Input
              id="c-desc"
              value={draft.description}
              onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Optional"
            />
          </div>
          {!draft.monitorId ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-status">Status</Label>
              <Select
                id="c-status"
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ComponentStatus }))}
              >
                {COMPONENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {componentStatusLabel(s)}
                  </option>
                ))}
              </Select>
            </div>
          ) : (
            <p className="text-xs text-muted">
              Status is driven automatically by the linked monitor&apos;s health.
            </p>
          )}
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={draft.showUptime}
              onChange={(e) => setDraft((d) => ({ ...d, showUptime: e.target.checked }))}
              className="size-4 rounded border-line bg-panel-2 accent-brand"
            />
            Show uptime history on the public page
          </label>

          {formError ? <Alert tone="error">{formError}</Alert> : null}

          <div className="flex justify-end gap-3">
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={onSubmitDraft}
              loading={createComponent.isPending || updateComponent.isPending}
            >
              {editing ? "Save changes" : "Add component"}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete component?"
        description={toDelete ? `"${toDelete.name}" will be removed from this page.` : undefined}
        confirmLabel="Delete component"
        loading={deleteComponent.isPending}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
