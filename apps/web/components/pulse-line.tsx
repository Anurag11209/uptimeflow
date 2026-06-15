import { cn } from "@/lib/utils";

/**
 * Signature brand element: an ECG-style pulse line that sweeps continuously.
 * Pure SVG + CSS so it costs nothing and works without JS.
 */
export function PulseLine({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 320 48"
      fill="none"
      aria-hidden
      className={cn("h-10 w-full text-up", className)}
      preserveAspectRatio="none"
    >
      <path
        className="pulse-path"
        d="M0 24 H72 L84 24 L92 8 L102 40 L110 18 L118 24 H180 L192 24 L200 10 L210 38 L218 20 L226 24 H320"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
