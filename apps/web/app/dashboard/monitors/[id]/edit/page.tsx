"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  useEscalationPolicies,
  useMonitor,
  useUpdateMonitor,
  type MonitorPayload,
} from "@/lib/monitors";
import { formStateFromMonitor } from "@/lib/monitor-form";
import { hasPermission } from "@backend-uptime/shared";

export default function EditMonitorPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const role = activeOrg?.role;
  const canUpdate = role ? hasPermission(role, "monitor", ["update"]) : false;

  const monitor = useMonitor(orgId, canUpdate ? id : undefined);
  const channels = useAlertChannels(orgId, canUpdate);
  const policies = useEscalationPolicies(orgId, canUpdate);
  const updateMonitor = useUpdateMonitor(orgId ?? "", id);
  const { toast } = useToast();
  const [serverError, setServerError] = useState<string | null>(null);

  async function onSubmit(payload: MonitorPayload) {
    setServerError(null);
    try {
      await updateMonitor.mutateAsync(payload);
      toast("Monitor updated.", "success");
      router.push(`/dashboard/monitors/${id}`);
    } catch (err) {
      setServerError(
        err instanceof ApiError ? err.message : "Could not update the monitor.",
      );
    }
  }

  if (orgPending) return <Skeleton className="h-96 w-full" />;
  if (!canUpdate) {
    return (
      <Alert tone="warning">You do not have permission to edit monitors.</Alert>
    );
  }
  if (monitor.isPending) return <Skeleton className="h-96 w-full" />;
  if (monitor.error || !monitor.data) {
    return (
      <Alert tone="error">
        {monitor.error instanceof ApiError
          ? monitor.error.message
          : "Monitor not found."}
      </Alert>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href={`/dashboard/monitors/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" /> Back to monitor
        </Link>
        <h1 className="mt-3 font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          Edit monitor
        </h1>
        <p className="mt-1 text-sm text-muted">{monitor.data.name}</p>
      </div>

      <MonitorForm
        initial={formStateFromMonitor(monitor.data)}
        channels={channels.data?.items ?? []}
        policies={policies.data?.items ?? []}
        submitLabel="Save changes"
        pending={updateMonitor.isPending}
        serverError={serverError}
        onSubmit={onSubmit}
        onCancel={() => router.push(`/dashboard/monitors/${id}`)}
      />
    </div>
  );
}
