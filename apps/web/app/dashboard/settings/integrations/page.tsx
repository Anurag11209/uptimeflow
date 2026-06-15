"use client";

import { useState, type FormEvent } from "react";
import { MessageSquare, Hash, Webhook, Send, Trash2, Copy } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import {
  deliveryStatusMeta,
  lastDeliveryFor,
  useChatIntegrations,
  useIntegrationDeliveries,
  useInvalidateIntegrations,
  useWebhookIntegrations,
  type ChatIntegration,
  type IntegrationDelivery,
  type WebhookIntegration,
} from "@/lib/integrations";
import { hasPermission } from "@backend-uptime/shared";

export default function IntegrationsPage() {
  const { data: activeOrg, isPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;

  const canRead = role ? hasPermission(role, "alertChannel", ["read"]) : false;
  const canManage = role ? hasPermission(role, "alertChannel", ["create", "update", "delete"]) : false;

  const deliveries = useIntegrationDeliveries(orgId, canRead);
  const deliveryItems = deliveries.data?.items ?? [];

  if (isPending) return <p className="text-sm text-muted">Loading…</p>;
  if (!canRead) {
    return <Alert tone="warning">You do not have permission to view integrations.</Alert>;
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">Integrations</h1>
        <p className="mt-1 text-sm text-muted">
          Send incident notifications to Slack, Discord, and your own webhooks.
        </p>
      </header>

      <ChatSection
        provider="slack"
        title="Slack"
        icon={<MessageSquare className="size-4" />}
        placeholder="https://hooks.slack.com/services/…"
        orgId={orgId}
        canManage={canManage}
        deliveries={deliveryItems}
      />
      <ChatSection
        provider="discord"
        title="Discord"
        icon={<Hash className="size-4" />}
        placeholder="https://discord.com/api/webhooks/…"
        orgId={orgId}
        canManage={canManage}
        deliveries={deliveryItems}
      />
      <WebhookSection orgId={orgId} canManage={canManage} deliveries={deliveryItems} />
    </div>
  );
}

function LastDelivery({ deliveries, id }: { deliveries: IntegrationDelivery[]; id: string }) {
  const last = lastDeliveryFor(deliveries, id);
  if (!last) return <span className="text-xs text-muted">No deliveries yet</span>;
  const meta = deliveryStatusMeta(last.status);
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      <Badge tone={meta.tone}>{meta.label}</Badge>
      <span>{new Date(last.createdAt).toLocaleString()}</span>
    </span>
  );
}

// ─────────────────────────── Slack / Discord ────────────────────────────────

function ChatSection({
  provider,
  title,
  icon,
  placeholder,
  orgId,
  canManage,
  deliveries,
}: {
  provider: "slack" | "discord";
  title: string;
  icon: React.ReactNode;
  placeholder: string;
  orgId: string | undefined;
  canManage: boolean;
  deliveries: IntegrationDelivery[];
}) {
  const { data, isPending } = useChatIntegrations(orgId, provider);
  const invalidate = useInvalidateIntegrations();
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const path = `/v1/organizations/${orgId}/integrations/${provider}`;
  const refresh = () => orgId && invalidate(orgId);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify({ name, webhookUrl }) });
      setName("");
      setWebhookUrl("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add integration.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!orgId) return;
    await api(`${path}/${id}`, { method: "DELETE" }).catch(() => {});
    refresh();
  }

  async function onTest(id: string) {
    if (!orgId) return;
    await api(`${path}/${id}/test`, { method: "POST" }).catch(() => {});
    refresh();
  }

  const items = data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        {icon}
        <h2 className="font-medium text-text">{title}</h2>
      </div>

      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No {title} integrations yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {items.map((it: ChatIntegration) => (
            <li key={it.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text">{it.name}</span>
                  {!it.enabled ? <Badge tone="muted">Disabled</Badge> : null}
                </div>
                <p className="truncate font-[family-name:var(--font-mono)] text-xs text-muted">
                  {it.webhookUrlPreview}
                </p>
                <div className="mt-1">
                  <LastDelivery deliveries={deliveries} id={it.id} />
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onTest(it.id)}>
                    <Send className="size-3.5" /> Test
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => onDelete(it.id)} aria-label="Delete">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={onCreate} className="mt-4 flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${provider}-name`}>Name</Label>
              <Input id={`${provider}-name`} value={name} onChange={(e) => setName(e.target.value)} required placeholder="Production alerts" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${provider}-url`}>Webhook URL</Label>
              <Input id={`${provider}-url`} value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} required placeholder={placeholder} />
            </div>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div>
            <Button type="submit" size="sm" loading={busy}>Add {title} integration</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}

// ─────────────────────────────── Webhooks ───────────────────────────────────

function WebhookSection({
  orgId,
  canManage,
  deliveries,
}: {
  orgId: string | undefined;
  canManage: boolean;
  deliveries: IntegrationDelivery[];
}) {
  const { data, isPending } = useWebhookIntegrations(orgId);
  const invalidate = useInvalidateIntegrations();
  const [name, setName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);

  const path = `/v1/organizations/${orgId}/integrations/webhooks`;
  const refresh = () => orgId && invalidate(orgId);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<{ secret: string }>(path, {
        method: "POST",
        body: JSON.stringify({ name, endpoint }),
      });
      setRevealedSecret(created.secret);
      setName("");
      setEndpoint("");
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!orgId) return;
    await api(`${path}/${id}`, { method: "DELETE" }).catch(() => {});
    refresh();
  }

  async function onTest(id: string) {
    if (!orgId) return;
    await api(`${path}/${id}/test`, { method: "POST" }).catch(() => {});
    refresh();
  }

  const items = data?.items ?? [];

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <Webhook className="size-4" />
        <h2 className="font-medium text-text">Webhooks</h2>
      </div>

      {revealedSecret ? (
        <Alert tone="success" className="mb-4">
          <div className="flex flex-col gap-1">
            <span className="font-medium">Signing secret — copy it now, it won’t be shown again:</span>
            <code className="flex items-center gap-2 break-all font-[family-name:var(--font-mono)] text-xs">
              <Copy className="size-3.5 shrink-0" />
              {revealedSecret}
            </code>
          </div>
        </Alert>
      ) : null}

      {isPending ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">No webhook integrations yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line-soft">
          {items.map((it: WebhookIntegration) => (
            <li key={it.id} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-text">{it.name}</span>
                  {!it.enabled ? <Badge tone="muted">Disabled</Badge> : null}
                </div>
                <p className="truncate font-[family-name:var(--font-mono)] text-xs text-muted">{it.endpoint}</p>
                <div className="mt-1">
                  <LastDelivery deliveries={deliveries} id={it.id} />
                </div>
              </div>
              {canManage ? (
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" onClick={() => onTest(it.id)}>
                    <Send className="size-3.5" /> Test
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => onDelete(it.id)} aria-label="Delete">
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage ? (
        <form onSubmit={onCreate} className="mt-4 flex flex-col gap-3 border-t border-line-soft pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-name">Name</Label>
              <Input id="wh-name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="Pager bridge" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wh-endpoint">HTTPS endpoint</Label>
              <Input id="wh-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} required placeholder="https://example.com/uptimeflow" />
            </div>
          </div>
          {error ? <Alert tone="error">{error}</Alert> : null}
          <div>
            <Button type="submit" size="sm" loading={busy}>Add webhook</Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
