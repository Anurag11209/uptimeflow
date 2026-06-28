"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ALL_REGIONS,
  monitorTypeLabel,
  regionLabel,
  SUPPORTED_MONITOR_TYPES,
  type AlertChannelItem,
  type EscalationPolicyItem,
  type MonitorPayload,
  type MonitorType,
  type ProbeRegion,
} from "@/lib/monitors";
import {
  buildMonitorPayload,
  INTERVAL_OPTIONS,
  isFormValid,
  typeIsHeartbeat,
  typeIsHttp,
  typeIsKeyword,
  typeNeedsHost,
  typeNeedsPort,
  typeNeedsUrl,
  validateMonitorForm,
  type MonitorFormErrors,
  type MonitorFormState,
} from "@/lib/monitor-form";
import { formatInterval } from "@/lib/monitors";

const HTTP_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const;

export interface MonitorFormProps {
  initial: MonitorFormState;
  channels: AlertChannelItem[];
  policies: EscalationPolicyItem[];
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  onSubmit: (payload: MonitorPayload) => void;
  onCancel: () => void;
}

function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted">{hint}</p> : null}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-down">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-[family-name:var(--font-display)] text-sm font-semibold text-text">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  );
}

export function MonitorForm({
  initial,
  channels,
  policies,
  submitLabel,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: MonitorFormProps) {
  const [state, setState] = useState<MonitorFormState>(initial);
  const [errors, setErrors] = useState<MonitorFormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof MonitorFormState>(key: K, value: MonitorFormState[K]) {
    setState((s) => {
      const next = { ...s, [key]: value };
      if (submitted) setErrors(validateMonitorForm(next));
      return next;
    });
  }

  function toggleRegion(region: ProbeRegion) {
    update(
      "regions",
      state.regions.includes(region)
        ? state.regions.filter((r) => r !== region)
        : [...state.regions, region],
    );
  }

  function toggleChannel(id: string) {
    update(
      "channelIds",
      state.channelIds.includes(id)
        ? state.channelIds.filter((c) => c !== id)
        : [...state.channelIds, id],
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const validation = validateMonitorForm(state);
    setErrors(validation);
    if (!isFormValid(validation)) return;
    onSubmit(buildMonitorPayload(state));
  }

  const isHttp = typeIsHttp(state.type);
  const isKeyword = typeIsKeyword(state.type);
  const isHeartbeat = typeIsHeartbeat(state.type);

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Section title="Basics">
        <Field label="Monitor name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            value={state.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Production API"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
        </Field>
        <Field label="Monitor type" htmlFor="type">
          <Select
            id="type"
            value={state.type}
            onChange={(e) => update("type", e.target.value as MonitorType)}
          >
            {SUPPORTED_MONITOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {monitorTypeLabel(t)}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section
        title="Target"
        description={
          isHeartbeat
            ? "Heartbeat monitors are pinged by your job — no outbound target."
            : "What this monitor checks."
        }
      >
        {typeNeedsUrl(state.type) ? (
          <Field label="URL" htmlFor="url" error={errors.url}>
            <Input
              id="url"
              value={state.url}
              onChange={(e) => update("url", e.target.value)}
              placeholder="https://example.com/health"
              aria-invalid={Boolean(errors.url)}
              aria-describedby={errors.url ? "url-error" : undefined}
            />
          </Field>
        ) : null}

        {typeNeedsHost(state.type) ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Host" htmlFor="host" error={errors.host}>
              <Input
                id="host"
                value={state.host}
                onChange={(e) => update("host", e.target.value)}
                placeholder="db.example.com"
                aria-invalid={Boolean(errors.host)}
              />
            </Field>
            {typeNeedsPort(state.type) ? (
              <Field label="Port" htmlFor="port" error={errors.port}>
                <Input
                  id="port"
                  inputMode="numeric"
                  value={state.port}
                  onChange={(e) => update("port", e.target.value)}
                  placeholder="5432"
                  aria-invalid={Boolean(errors.port)}
                />
              </Field>
            ) : null}
          </div>
        ) : null}

        {isHttp ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Request method" htmlFor="httpMethod">
              <Select
                id="httpMethod"
                value={state.httpMethod}
                onChange={(e) =>
                  update("httpMethod", e.target.value as MonitorFormState["httpMethod"])
                }
              >
                {HTTP_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Expected status"
              htmlFor="expectedStatus"
              error={errors.expectedStatus}
              hint="Optional — defaults to any 2xx."
            >
              <Input
                id="expectedStatus"
                inputMode="numeric"
                value={state.expectedStatus}
                onChange={(e) => update("expectedStatus", e.target.value)}
                placeholder="200"
                aria-invalid={Boolean(errors.expectedStatus)}
              />
            </Field>
          </div>
        ) : null}

        {isKeyword ? (
          <>
            <Field
              label="Keyword"
              htmlFor="keyword"
              error={errors.keyword}
              hint="Text that must appear in the response body."
            >
              <Input
                id="keyword"
                value={state.keyword}
                onChange={(e) => update("keyword", e.target.value)}
                placeholder="Welcome"
                aria-invalid={Boolean(errors.keyword)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                checked={state.keywordInverted}
                onChange={(e) => update("keywordInverted", e.target.checked)}
                className="size-4 rounded border-line bg-panel-2 accent-brand"
              />
              Alert when the keyword is <strong>present</strong> (inverted)
            </label>
          </>
        ) : null}

        {isHttp ? (
          <Field
            label="Request headers"
            htmlFor="requestHeaders"
            error={errors.requestHeaders}
            hint='One per line, "Key: Value".'
          >
            <Textarea
              id="requestHeaders"
              value={state.requestHeaders}
              onChange={(e) => update("requestHeaders", e.target.value)}
              placeholder={"Authorization: Bearer …\nX-Env: production"}
              className="font-[family-name:var(--font-mono)] text-xs"
            />
          </Field>
        ) : null}
      </Section>

      <Section title="Scheduling">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label={isHeartbeat ? "Expected period" : "Check interval"}
            htmlFor="intervalSeconds"
            error={errors.intervalSeconds}
          >
            <Select
              id="intervalSeconds"
              value={state.intervalSeconds}
              onChange={(e) => update("intervalSeconds", e.target.value)}
            >
              {INTERVAL_OPTIONS.map((s) => (
                <option key={s} value={String(s)}>
                  Every {formatInterval(s)}
                </option>
              ))}
            </Select>
          </Field>
          {!isHeartbeat ? (
            <>
              <Field label="Timeout (s)" htmlFor="timeoutSeconds" error={errors.timeoutSeconds}>
                <Input
                  id="timeoutSeconds"
                  inputMode="numeric"
                  value={state.timeoutSeconds}
                  onChange={(e) => update("timeoutSeconds", e.target.value)}
                  aria-invalid={Boolean(errors.timeoutSeconds)}
                />
              </Field>
              <Field label="Retries" htmlFor="retries" error={errors.retries}>
                <Input
                  id="retries"
                  inputMode="numeric"
                  value={state.retries}
                  onChange={(e) => update("retries", e.target.value)}
                  aria-invalid={Boolean(errors.retries)}
                />
              </Field>
            </>
          ) : null}
        </div>

        {!isHeartbeat ? (
          <Field
            label="Probe regions"
            htmlFor="regions"
            hint="Leave empty to use the default region."
          >
            <div
              id="regions"
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              role="group"
              aria-label="Probe regions"
            >
              {ALL_REGIONS.map((region) => {
                const active = state.regions.includes(region);
                return (
                  <button
                    type="button"
                    key={region}
                    onClick={() => toggleRegion(region)}
                    aria-pressed={active}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                      active
                        ? "border-brand/60 bg-brand/10 text-brand"
                        : "border-line bg-panel-2 text-muted hover:text-text",
                    )}
                  >
                    {regionLabel(region)}
                  </button>
                );
              })}
            </div>
          </Field>
        ) : null}
      </Section>

      {!isHeartbeat ? (
        <Section
          title="Reliability"
          description="How many consecutive results flip a monitor's state."
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Failure threshold"
              htmlFor="failureThreshold"
              error={errors.failureThreshold}
              hint="Failing checks before opening an incident."
            >
              <Input
                id="failureThreshold"
                inputMode="numeric"
                value={state.failureThreshold}
                onChange={(e) => update("failureThreshold", e.target.value)}
                aria-invalid={Boolean(errors.failureThreshold)}
              />
            </Field>
            <Field
              label="Recovery threshold"
              htmlFor="successThreshold"
              error={errors.successThreshold}
              hint="Passing checks before resolving."
            >
              <Input
                id="successThreshold"
                inputMode="numeric"
                value={state.successThreshold}
                onChange={(e) => update("successThreshold", e.target.value)}
                aria-invalid={Boolean(errors.successThreshold)}
              />
            </Field>
          </div>
        </Section>
      ) : null}

      <Section
        title="Alerting"
        description="Where to send notifications when this monitor changes state."
      >
        <Field label="Alert channels" htmlFor="channels">
          {channels.length === 0 ? (
            <p className="text-xs text-muted">
              No alert channels yet.{" "}
              <a href="/dashboard/settings/alert-channels" className="text-brand underline">
                Create one in Settings → Alert Channels
              </a>{" "}
              first.
            </p>
          ) : (
            <div id="channels" className="flex flex-col gap-2">
              {channels.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={state.channelIds.includes(c.id)}
                    onChange={() => toggleChannel(c.id)}
                    className="size-4 rounded border-line bg-panel-2 accent-brand"
                  />
                  <span>{c.name}</span>
                  <span className="text-xs text-muted">({c.type})</span>
                </label>
              ))}
            </div>
          )}
        </Field>

        <Field
          label="Escalation policy"
          htmlFor="escalationPolicyId"
          hint="Optional — routes alerts through an on-call schedule."
        >
          <Select
            id="escalationPolicyId"
            value={state.escalationPolicyId}
            onChange={(e) => update("escalationPolicyId", e.target.value)}
          >
            <option value="">None</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      {serverError ? <Alert tone="error">{serverError}</Alert> : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
