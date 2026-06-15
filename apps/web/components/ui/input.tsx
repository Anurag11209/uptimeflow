import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type = "text", ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-text",
        "placeholder:text-muted/60",
        "transition-colors focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
