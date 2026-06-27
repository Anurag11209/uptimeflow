import { cn } from "@/lib/utils";
import type { HTMLAttributes } from "react";

/** Animated placeholder block used while server state loads. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-line-soft/70", className)}
      {...props}
    />
  );
}
