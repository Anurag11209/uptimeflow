"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { MonitorForm } from "@/components/monitors/monitor-form";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import {
  useAlertChannels,
  useCreateMonitor,
  useEscalationPolicies,
  type MonitorPayload,
} from "@/lib/monitors";
import { defaultMonitorForm } from "@/lib/monitor-form";
import { hasPermission } from "@backend-uptime/shared";

export default function NewMonitorPage() {
  const router = useRouter();
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canCreate = role ? hasPermission(role, "monitor", ["create"]) : false;

  const channels = useAlertChannels(orgId, canCreate);
  const policies = useEscalationPolicies(orgId, canCreate);
  const createMonitor = useCreateMonitor(orgId ?? "");
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(payload: MonitorPayload) {
    setServerError(null);
    try {
      const created = await createMonitor.mutateAsync(payload);
      toast("Monitor created — first check runs shortly.", "success");
      router.push(`/dashboard/monitors/${created.id}`);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Could not create the monitor.",
      );
    }
  }

  if (orgPending) return <Skeleton className="h-96 w-full" />;
  if (!canCreate) {
    return (
      <Alert tone="warning">
        You do not have permission to create monitors.
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/monitors"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" /> Back to monitors
        </Link>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          New monitor
        </h1>
        <p className="mt-1 text-sm text-muted">
          Configure a check and we&apos;ll start watching it within a minute.
        </p>
      </div>

      <MonitorForm
        initial={defaultMonitorForm()}
        channels={channels.data?.items ?? []}
        policies={policies.data?.items ?? []}
        submitLabel="Create monitor"
        pending={createMonitor.isPending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => router.push("/dashboard/monitors")}
      />
    </div>
  );
}
