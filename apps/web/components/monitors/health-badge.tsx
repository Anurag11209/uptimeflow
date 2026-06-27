import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { healthMeta, type MonitorHealth } from "@/lib/monitors";

/** Status pill with a leading dot. Live monitors (up/down) get a blinking dot. */
export function HealthBadge({ health }: { health: MonitorHealth }) {
  const meta = healthMeta(health);
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
          (health === "UP" || health === "DOWN") && "status-dot",
        )}
      />
      {meta.label}
    </Badge>
  );
}
