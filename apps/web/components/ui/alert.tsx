import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

type Tone = "error" | "success" | "info" | "warning";

const toneClasses: Record<Tone, string> = {
  error: "border-down/40 bg-down/10 text-down",
  success: "border-up/40 bg-up/10 text-up",
  info: "border-line bg-panel-2 text-muted",
  warning: "border-warn/40 bg-warn/10 text-warn",
};

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: Tone;
}

export function Alert({ className, tone = "info", ...props }: AlertProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-md border px-4 py-3 text-sm leading-relaxed",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
