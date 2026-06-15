import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Tone = "default" | "brand" | "up" | "down" | "muted";

const toneClasses: Record<Tone, string> = {
  default: "border-line text-text",
  brand: "border-brand/50 bg-brand/10 text-brand",
  up: "border-up/50 bg-up/10 text-up",
  down: "border-down/50 bg-down/10 text-down",
  muted: "border-line-soft text-muted",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ className, tone = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
