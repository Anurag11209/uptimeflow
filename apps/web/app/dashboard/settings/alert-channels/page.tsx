"use client";

import { useState } from "react";
import Link from "next/link";
import { BellRing, Edit, Plus, Power, PowerOff, Trash2 } from "lucide-react";
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
import { useActiveOrg } from "@/lib/queries";
import { hasPermission } from "@backend-uptime/shared";
import {
  useAlertChannels,
  useCreateAlertChannel,
  useUpdateAlertChannel,
  useDeleteAlertChannel,
  useEnableAlertChannel,
  useDisableAlertChannel,
  formatChannelType,
  channelStatusMeta,
  configKeyFor,
  primaryConfigValue,
  buildConfig,
  isIntegrationBacked,
  STUB_TRANSPORT_TYPES,
  type AlertChannelType,
  type AlertChannelItem,
} from "@/lib/alert-channels";
import { formatDateTime } from "@/lib/format";
import { useChatIntegrations, useWebhookIntegrations } from "@/lib/integrations";
import type { ChatIntegration, WebhookIntegration } from "@/lib/integrations";

// Channel types shown in the create form (excludes enterprise-only ones for now)
const CHANNEL_TYPES: AlertChannelType[] = ["EMAIL", "SMS", "VOICE", "SLACK", "DISCORD", "WEBHOOK"];

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

interface ChannelModalProps {
  open: boolean;
  editingChannel: AlertChannelItem | null;
  orgId: string;
  canRead: boolean;
  onClose: () => void;
}

function ChannelModal({ open, editingChannel, orgId, canRead, onClose }: ChannelModalProps) {
  const isEditing = Boolean(editingChannel);

  const [name, setName] = useState(editingChannel?.name ?? "");
  const [type, setType] = useState<AlertChannelType>(editingChannel?.type ?? "EMAIL");
  const [configValue, setConfigValue] = useState(
    editingChannel ? primaryConfigValue(editingChannel) : "",
  );
  const [formError, setFormError] = useState<string | null>(null);

  const createChannel = useCreateAlertChannel(orgId);
  const updateChannel = useUpdateAlertChannel(orgId);
  const { toast } = useToast();

  // Integration lists for integration-backed channel types
  const slackIntegrations = useChatIntegrations(orgId, "slack", canRead);
  const discordIntegrations = useChatIntegrations(orgId, "discord", canRead);
  const webhookIntegrations = useWebhookIntegrations(orgId, canRead);

  const slackItems: ChatIntegration[] = slackIntegrations.data?.items ?? [];
  const discordItems: ChatIntegration[] = discordIntegrations.data?.items ?? [];
  const webhookItems: WebhookIntegration[] = webhookIntegrations.data?.items ?? [];

  async function onSubmit() {
    setFormError(null);
    if (!name.trim()) {
      setFormError("Name is required.");
      return;
    }
    if (!configValue.trim()) {
      setFormError(
        isIntegrationBacked(type)
          ? "Please select an integration."
          : `${configKeyFor(type) === "email" ? "Email address" : "Phone number"} is required.`,
      );
      return;
    }

    try {
      if (editingChannel) {
        await updateChannel.mutateAsync({
          id: editingChannel.id,
          input: { name: name.trim(), config: buildConfig(type, configValue.trim()) },
        });
        toast("Alert channel updated.", "success");
      } else {
        await createChannel.mutateAsync({
          name: name.trim(),
          type,
          config: buildConfig(type, configValue.trim()),
        });
        toast("Alert channel created.", "success");
      }
      onClose();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not save alert channel.");
    }
  }

  const isPending = createChannel.isPending || updateChannel.isPending;

  return (
    <Modal
      open={open}
      title={isEditing ? "Edit Alert Channel" : "New Alert Channel"}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ac-name">Internal name</Label>
          <Input
            id="ac-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. DevOps On-Call"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ac-type">Channel type</Label>
          <Select
            id="ac-type"
            value={type}
            onChange={(e) => {
              setType(e.target.value as AlertChannelType);
              setConfigValue(""); // reset when type changes
            }}
            disabled={isEditing} // type is immutable after creation
          >
            {CHANNEL_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatChannelType(t)}
              </option>
            ))}
          </Select>
          {isEditing && (
            <p className="text-xs text-muted">Channel type cannot be changed after creation.</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          {type === "EMAIL" && (
            <>
              <Label htmlFor="ac-config">Email address</Label>
              <Input
                id="ac-config"
                type="email"
                value={configValue}
                onChange={(e) => setConfigValue(e.target.value)}
                placeholder="devops@company.com"
              />
            </>
          )}

          {(type === "SMS" || type === "VOICE") && (
            <>
              <Label htmlFor="ac-config">Phone number</Label>
              <Input
                id="ac-config"
                type="tel"
                value={configValue}
                onChange={(e) => setConfigValue(e.target.value)}
                placeholder="+1234567890"
              />
            </>
          )}

          {isIntegrationBacked(type) && (
            <>
              <Label htmlFor="ac-config">{formatChannelType(type)} integration</Label>
              <Select
                id="ac-config"
                value={configValue}
                onChange={(e) => setConfigValue(e.target.value)}
              >
                <option value="">Select an integration…</option>
                {type === "SLACK" &&
                  slackItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                {type === "DISCORD" &&
                  discordItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                {type === "WEBHOOK" &&
                  webhookItems.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
              </Select>
              <p className="text-xs text-muted">
                Don&apos;t see yours?{" "}
                <Link href="/dashboard/settings/integrations" className="text-brand underline">
                  Add it in Integrations
                </Link>
                .
              </p>
            </>
          )}
        </div>

        {/* Warn when the chosen type is a stub transport */}
        {STUB_TRANSPORT_TYPES.includes(type) && (
          <Alert tone="warning">
            <strong>{formatChannelType(type)}</strong> delivery is not yet implemented — alerts will
            be recorded but no notification will be sent. Only <strong>Webhook</strong> channels
            deliver real notifications right now.
          </Alert>
        )}

        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="mt-2 flex justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSubmit} loading={isPending}>
            {isEditing ? "Save changes" : "Create channel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AlertChannelsPage() {
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "alertChannel", ["read"]) : false;
  const canCreate = role ? hasPermission(role, "alertChannel", ["create"]) : false;
  const canUpdate = role ? hasPermission(role, "alertChannel", ["update"]) : false;
  const canDelete = role ? hasPermission(role, "alertChannel", ["delete"]) : false;

  const { data, isPending } = useAlertChannels(orgId, canRead);
  const enableChannel = useEnableAlertChannel(orgId ?? "");
  const disableChannel = useDisableAlertChannel(orgId ?? "");
  const deleteChannel = useDeleteAlertChannel(orgId ?? "");

  const { toast } = useToast();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<AlertChannelItem | null>(null);
  const [toDelete, setToDelete] = useState<AlertChannelItem | null>(null);
  // Track which row's toggle is busy so only that row shows a spinner
  const [busyToggleId, setBusyToggleId] = useState<string | null>(null);

  const allChannels: AlertChannelItem[] = data?.items ?? [];

  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view alert channels.</Alert>;
  }

  function openCreate() {
    setEditingChannel(null);
    setModalOpen(true);
  }

  function openEdit(channel: AlertChannelItem) {
    setEditingChannel(channel);
    setModalOpen(true);
  }

  async function onToggle(channel: AlertChannelItem) {
    setBusyToggleId(channel.id);
    try {
      if (channel.enabled) {
        await disableChannel.mutateAsync(channel.id);
        toast(`Disabled "${channel.name}".`, "success");
      } else {
        await enableChannel.mutateAsync(channel.id);
        toast(`Enabled "${channel.name}".`, "success");
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not update status.", "error");
    } finally {
      setBusyToggleId(null);
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    try {
      await deleteChannel.mutateAsync(toDelete.id);
      toast("Alert channel deleted.", "success");
      setToDelete(null);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not delete channel.", "error");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
            Alert Channels
          </h2>
          <p className="mt-1 text-sm text-muted">
            Configure where incident notifications are sent. Attach channels to individual monitors.
          </p>
        </div>
        {canCreate && (
          <Button size="sm" onClick={openCreate}>
            <Plus className="size-4" />
            New channel
          </Button>
        )}
      </div>

      {/* List */}
      {isPending ? (
        <Skeleton className="h-48 w-full" />
      ) : allChannels.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <div className="grid size-11 place-items-center rounded-full border border-line bg-panel-2">
            <BellRing className="size-5 text-muted" />
          </div>
          <p className="text-sm font-medium text-text">No alert channels yet</p>
          <p className="max-w-sm text-sm text-muted">
            Create a channel to notify your team when a monitor goes down. Then attach it to one or
            more monitors.
          </p>
          {canCreate && (
            <Button size="sm" className="mt-1" onClick={openCreate}>
              <Plus className="size-4" />
              New channel
            </Button>
          )}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left">
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                    Name
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                    Type
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted">
                    Updated
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {allChannels.map((channel) => {
                  const meta = channelStatusMeta(channel.enabled);
                  const isStub = STUB_TRANSPORT_TYPES.includes(channel.type);
                  return (
                    <tr key={channel.id} className="group hover:bg-panel-2/50">
                      <td className="px-4 py-3">
                        <span className="font-medium text-text">{channel.name}</span>
                        {isStub && (
                          <span className="ml-2 text-xs text-muted">(no delivery yet)</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone="muted">{formatChannelType(channel.type)}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted">{formatDateTime(channel.updatedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                          {canUpdate && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                title={channel.enabled ? "Disable" : "Enable"}
                                loading={busyToggleId === channel.id}
                                onClick={() => onToggle(channel)}
                              >
                                {channel.enabled ? (
                                  <PowerOff className="size-3.5" />
                                ) : (
                                  <Power className="size-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Edit"
                                onClick={() => openEdit(channel)}
                              >
                                <Edit className="size-3.5" />
                              </Button>
                            </>
                          )}
                          {canDelete && (
                            <Button
                              variant="danger"
                              size="sm"
                              title="Delete"
                              onClick={() => setToDelete(channel)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Create / Edit modal */}
      {modalOpen && orgId && (
        <ChannelModal
          open={modalOpen}
          editingChannel={editingChannel}
          orgId={orgId}
          canRead={canRead}
          onClose={() => {
            setModalOpen(false);
            setEditingChannel(null);
          }}
        />
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete alert channel?"
        description={
          toDelete
            ? `Delete "${toDelete.name}"? Monitors using this channel will stop sending notifications here.`
            : undefined
        }
        confirmLabel="Delete channel"
        loading={deleteChannel.isPending}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
