import Link from "next/link";
import { PulseLine } from "@/components/pulse-line";

const REGIONS = [
  { code: "iad", name: "N. Virginia" },
  { code: "sfo", name: "San Francisco" },
  { code: "gru", name: "São Paulo" },
  { code: "lhr", name: "London" },
  { code: "fra", name: "Frankfurt" },
  { code: "bom", name: "Mumbai" },
  { code: "sin", name: "Singapore" },
  { code: "syd", name: "Sydney" },
] as const;

/**
 * Split-screen shell for all auth pages: brand/status wall on the left
 * (hidden under lg), the form card on the right.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden border-r border-line-soft bg-panel-2 p-10 lg:flex">
        <Link
          href="/"
          className="flex items-center gap-3 font-[family-name:var(--font-display)] text-lg font-semibold tracking-tight"
        >
          <span className="grid size-9 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-sm text-brand">
            BU
          </span>
          Backend Uptime
        </Link>

        <div className="space-y-8">
          <PulseLine className="opacity-80" />
          <div>
            <p className="font-[family-name:var(--font-display)] text-3xl font-semibold leading-tight">
              Every second of downtime,
              <br />
              accounted for.
            </p>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted">
              Checks from eight regions, incident timelines your customers can
              read, and alerts that reach the person on call — not a dead
              channel.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line-soft bg-line-soft">
            {REGIONS.map((region) => (
              <div
                key={region.code}
                className="flex items-center justify-between bg-panel px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="status-dot size-1.5 rounded-full bg-up" />
                  <span className="font-[family-name:var(--font-mono)] text-xs uppercase text-muted">
                    {region.code}
                  </span>
                </div>
                <span className="text-xs text-muted/70">{region.name}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="font-[family-name:var(--font-mono)] text-[11px] uppercase tracking-widest text-muted/60">
          status: all systems operational
        </p>
      </aside>

      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Link
              href="/"
              className="flex items-center gap-3 font-[family-name:var(--font-display)] text-lg font-semibold"
            >
              <span className="grid size-9 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-sm text-brand">
                BU
              </span>
              Backend Uptime
            </Link>
          </div>

          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>
          ) : null}

          <div className="mt-8">{children}</div>

          {footer ? (
            <div className="mt-8 text-sm text-muted">{footer}</div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
