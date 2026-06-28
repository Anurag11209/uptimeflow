"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { Alert } from "@/components/ui/alert";
import { useToast } from "@/components/ui/toast";
import { StatusPageForm } from "@/components/status-pages/status-page-form";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { useCreateStatusPage, type StatusPagePayload } from "@/lib/status-pages";
import { defaultStatusPageForm } from "@/lib/status-page-form";
import { hasPermission } from "@backend-uptime/shared";

export default function NewStatusPage() {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canCreate = role ? hasPermission(role, "statusPage", ["create"]) : false;

  const createPage = useCreateStatusPage(orgId ?? "");
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(payload: StatusPagePayload) {
    setServerError(null);
    try {
      const created = await createPage.mutateAsync(payload);
      toast("Status page created.", "success");
      router.push(`/dashboard/status-pages/${created.id}`);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : "Could not create status page.");
    }
  }

  if (activeOrg && !canCreate) {
    return <Alert tone="warning">You do not have permission to create status pages.</Alert>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <ButtonLink href="/dashboard/status-pages" variant="ghost" size="sm" className="mb-2 -ml-2">
          <ArrowLeft className="size-4" /> Status pages
        </ButtonLink>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          New status page
        </h1>
        <p className="mt-1 text-sm text-muted">
          Add components and publish incidents after creating the page.
        </p>
      </div>

      <StatusPageForm
        initial={defaultStatusPageForm()}
        autoSlug
        submitLabel="Create status page"
        pending={createPage.isPending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => router.push("/dashboard/status-pages")}
      />
    </div>
  );
}
