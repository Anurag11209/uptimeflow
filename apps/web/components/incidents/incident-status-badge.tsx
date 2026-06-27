import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { incidentStatusMeta, type IncidentStatus } from "@/lib/monitors";

/** Status pill; an open incident gets a blinking dot to read as "live". */
export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const meta = incidentStatusMeta(status);
  const dotTone =
    meta.tone === "up"
      ? "bg-up"
      : meta.tone === "down"
        ? "bg-down"
        : meta.tone === "brand"
          ? "bg-brand"
          : "bg-muted";
  return (
    <Badge tone={meta.tone}>
      <span
        className={cn(
          "size-1.5 rounded-full",
          dotTone,
          status === "OPEN" && "status-dot",
        )}
      />
      {meta.label}
    </Badge>
  );
}
