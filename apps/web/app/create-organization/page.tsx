"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { slugify } from "@/lib/slug";

export default function CreateOrganizationPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    const finalSlug = effectiveSlug;
    if (finalSlug.length < 2) {
      setError("Choose a slug with at least 2 characters.");
      return;
    }

    setPending(true);

    // Pre-flight: Better Auth exposes a slug availability check.
    const { data: available } = await authClient.organization.checkSlug({
      slug: finalSlug,
    });
    if (available && available.status === false) {
      setPending(false);
      setError("That slug is already taken. Try another.");
      return;
    }

    const { data, error: createError } =
      await authClient.organization.create({
        name,
        slug: finalSlug,
      });

    if (createError || !data) {
      setPending(false);
      setError(createError?.message ?? "Could not create the organization.");
      return;
    }

    await authClient.organization.setActive({ organizationId: data.id });
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <AuthShell
      title="Create your organization"
      subtitle="Organizations own monitors, status pages, billing, and team access. You'll be the owner."
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error ? <Alert tone="error">{error}</Alert> : null}

        <div className="space-y-2">
          <Label htmlFor="org-name">Organization name</Label>
          <Input
            id="org-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="org-slug">Slug</Label>
          <div className="flex items-center rounded-md border border-line bg-panel-2 focus-within:border-brand/70">
            <span className="pl-3 font-[family-name:var(--font-mono)] text-xs text-muted">
              status.app/
            </span>
            <input
              id="org-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
              className="h-10 flex-1 bg-transparent px-1 font-[family-name:var(--font-mono)] text-sm text-text focus:outline-none"
              placeholder="acme"
            />
          </div>
          <p className="text-xs text-muted">
            Lowercase letters, numbers, and hyphens. Used in status page URLs.
          </p>
        </div>

        <Button type="submit" className="w-full" loading={pending}>
          Create organization
        </Button>
      </form>
    </AuthShell>
  );
}
