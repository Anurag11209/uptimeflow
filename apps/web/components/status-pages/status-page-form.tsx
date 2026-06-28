"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { slugify } from "@/lib/slug";
import { VISIBILITIES, type StatusPagePayload, type StatusPageVisibility } from "@/lib/status-pages";
import {
  buildStatusPagePayload,
  isFormValid,
  validateStatusPageForm,
  type StatusPageFormErrors,
  type StatusPageFormState,
} from "@/lib/status-page-form";

const VISIBILITY_LABEL: Record<StatusPageVisibility, string> = {
  PUBLIC: "Public — listed and indexable",
  UNLISTED: "Unlisted — reachable by link only",
  PRIVATE: "Private — hidden from the public",
};

export interface StatusPageFormProps {
  initial: StatusPageFormState;
  /** When true, the slug field auto-fills from the name until the user edits it. */
  autoSlug?: boolean;
  submitLabel: string;
  pending: boolean;
  serverError?: string | null;
  onSubmit: (payload: StatusPagePayload) => void;
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

export function StatusPageForm({
  initial,
  autoSlug = false,
  submitLabel,
  pending,
  serverError,
  onSubmit,
  onCancel,
}: StatusPageFormProps) {
  const [state, setState] = useState<StatusPageFormState>(initial);
  const [errors, setErrors] = useState<StatusPageFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [slugTouched, setSlugTouched] = useState(!autoSlug);

  function update<K extends keyof StatusPageFormState>(key: K, value: StatusPageFormState[K]) {
    setState((s) => {
      const next = { ...s, [key]: value };
      if (submitted) setErrors(validateStatusPageForm(next));
      return next;
    });
  }

  function onNameChange(value: string) {
    setState((s) => {
      const next = { ...s, name: value };
      if (!slugTouched) next.slug = slugify(value);
      if (submitted) setErrors(validateStatusPageForm(next));
      return next;
    });
  }

  function setLink(index: number, patch: Partial<{ label: string; url: string }>) {
    update(
      "socialLinks",
      state.socialLinks.map((l, i) => (i === index ? { ...l, ...patch } : l)),
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const validation = validateStatusPageForm(state);
    setErrors(validation);
    if (!isFormValid(validation)) return;
    onSubmit(buildStatusPagePayload(state));
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
      <Section title="Basics" description="Identify your status page.">
        <Field label="Name" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            value={state.name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Acme Status"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "name-error" : undefined}
          />
        </Field>
        <Field
          label="Slug"
          htmlFor="slug"
          error={errors.slug}
          hint="Used in the public URL: /status/<slug>"
        >
          <Input
            id="slug"
            value={state.slug}
            onChange={(e) => {
              setSlugTouched(true);
              update("slug", e.target.value);
            }}
            placeholder="acme"
            className="font-[family-name:var(--font-mono)]"
            aria-invalid={Boolean(errors.slug)}
            aria-describedby={errors.slug ? "slug-error" : undefined}
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          error={errors.description}
          hint="Optional — shown under the page title."
        >
          <Textarea
            id="description"
            value={state.description}
            onChange={(e) => update("description", e.target.value)}
            placeholder="Real-time status of Acme's services."
            rows={3}
          />
        </Field>
      </Section>

      <Section title="Visibility" description="Control who can reach this page.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Visibility" htmlFor="visibility">
            <Select
              id="visibility"
              value={state.visibility}
              onChange={(e) => update("visibility", e.target.value as StatusPageVisibility)}
            >
              {VISIBILITIES.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABEL[v]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Timezone" htmlFor="timezone" hint="Used to localize timestamps.">
            <Input
              id="timezone"
              value={state.timezone}
              onChange={(e) => update("timezone", e.target.value)}
              placeholder="UTC"
              className="font-[family-name:var(--font-mono)]"
            />
          </Field>
        </div>
        <Field
          label="Custom domain"
          htmlFor="customDomain"
          error={errors.customDomain}
          hint="Optional — connect & verify it under the Settings tab after creating."
        >
          <Input
            id="customDomain"
            value={state.customDomain}
            onChange={(e) => update("customDomain", e.target.value)}
            placeholder="status.acme.com"
            className="font-[family-name:var(--font-mono)]"
            aria-invalid={Boolean(errors.customDomain)}
            aria-describedby={errors.customDomain ? "customDomain-error" : undefined}
          />
        </Field>
      </Section>

      <Section title="Branding" description="Customize how the public page looks.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Logo URL" htmlFor="logoUrl" error={errors.logoUrl}>
            <Input
              id="logoUrl"
              value={state.logoUrl}
              onChange={(e) => update("logoUrl", e.target.value)}
              placeholder="https://acme.com/logo.svg"
              aria-invalid={Boolean(errors.logoUrl)}
            />
          </Field>
          <Field label="Favicon URL" htmlFor="faviconUrl" error={errors.faviconUrl}>
            <Input
              id="faviconUrl"
              value={state.faviconUrl}
              onChange={(e) => update("faviconUrl", e.target.value)}
              placeholder="https://acme.com/favicon.ico"
              aria-invalid={Boolean(errors.faviconUrl)}
            />
          </Field>
        </div>
        <Field label="Brand color" htmlFor="accent" error={errors.accent}>
          <div className="flex items-center gap-3">
            <input
              type="color"
              aria-label="Brand color picker"
              value={/^#[0-9a-fA-F]{6}$/.test(state.accent) ? state.accent : "#ffb224"}
              onChange={(e) => update("accent", e.target.value)}
              className="h-10 w-12 cursor-pointer rounded-md border border-line bg-panel-2"
            />
            <Input
              id="accent"
              value={state.accent}
              onChange={(e) => update("accent", e.target.value)}
              placeholder="#ffb224"
              className="max-w-40 font-[family-name:var(--font-mono)]"
              aria-invalid={Boolean(errors.accent)}
            />
          </div>
        </Field>
        <Field
          label="Footer text"
          htmlFor="footerText"
          error={errors.footerText}
          hint="Optional — shown in the page footer."
        >
          <Input
            id="footerText"
            value={state.footerText}
            onChange={(e) => update("footerText", e.target.value)}
            placeholder="© Acme Inc."
          />
        </Field>

        <Field label="Social links" htmlFor="social" error={errors.socialLinks}>
          <div id="social" className="flex flex-col gap-2">
            {state.socialLinks.map((link, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={link.label}
                  onChange={(e) => setLink(i, { label: e.target.value })}
                  placeholder="Twitter"
                  aria-label={`Social link ${i + 1} label`}
                  className="max-w-40"
                />
                <Input
                  value={link.url}
                  onChange={(e) => setLink(i, { url: e.target.value })}
                  placeholder="https://twitter.com/acme"
                  aria-label={`Social link ${i + 1} URL`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    update(
                      "socialLinks",
                      state.socialLinks.filter((_, idx) => idx !== i),
                    )
                  }
                  aria-label={`Remove social link ${i + 1}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
            {state.socialLinks.length < 10 ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="self-start"
                onClick={() => update("socialLinks", [...state.socialLinks, { label: "", url: "" }])}
              >
                <Plus className="size-3.5" /> Add link
              </Button>
            ) : null}
          </div>
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
