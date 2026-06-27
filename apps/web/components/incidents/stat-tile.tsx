import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/monitors";

export interface StatTileProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
}

const toneText: Record<Tone, string> = {
  up: "text-up",
  down: "text-down",
  brand: "text-brand",
  muted: "text-muted",
  default: "text-text",
};

/** Reusable KPI widget for the incident dashboard. */
export function StatTile({ icon: Icon, label, value, hint, tone = "default" }: StatTileProps) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted">{label}</span>
        <Icon className={cn("size-4", toneText[tone])} />
      </div>
      <p
        className={cn(
          "mt-2 font-[family-name:var(--font-display)] text-2xl font-semibold tabular-nums",
          toneText[tone],
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}
