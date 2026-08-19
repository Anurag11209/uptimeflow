import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  BellRing,
  Globe2,
  LayoutPanelTop,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";
import { PulseLine } from "@/components/pulse-line";

const REGIONS = [
  { code: "iad", name: "N. Virginia", ping: "24ms" },
  { code: "sfo", name: "San Francisco", ping: "18ms" },
  { code: "lhr", name: "London", ping: "42ms" },
  { code: "fra", name: "Frankfurt", ping: "48ms" },
  { code: "sin", name: "Singapore", ping: "76ms" },
  { code: "bom", name: "Mumbai", ping: "89ms" },
];

const FEATURES = [
  {
    icon: Globe2,
    title: "Multi-Region Probes",
    description:
      "Synthetically check HTTP, TCP, SSL, and custom keywords across 8 global probe locations with sub-minute frequency.",
  },
  {
    icon: BellRing,
    title: "On-Call & Escalations",
    description:
      "Route critical incidents to rotation schedules via Slack, Discord, SMS, Webhooks, or PagerDuty without missed alerts.",
  },
  {
    icon: LayoutPanelTop,
    title: "Public Status Pages",
    description:
      "Communicate incidents and scheduled maintenance transparently under your own custom domain with automatic SSL.",
  },
  {
    icon: BarChart3,
    title: "SLA & Latency Analytics",
    description:
      "Deep percentile latency rollups (p50, p95, p99), regional heatmaps, and downloadable SLA availability reports.",
  },
];

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-line-soft bg-ink/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Link
            href="/"
            className="flex items-center gap-3 font-[family-name:var(--font-display)] text-base font-semibold"
          >
            <span className="grid size-8 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-xs text-brand">
              BU
            </span>
            <span>Backend Uptime</span>
          </Link>
          <nav className="flex items-center gap-2.5">
            <ButtonLink href="/sign-in" variant="ghost" size="sm">
              Sign in
            </ButtonLink>
            <ButtonLink href="/sign-up" size="sm">
              Get started <ArrowRight className="size-3.5" />
            </ButtonLink>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero Section */}
        <section className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-medium text-brand">
              <span className="status-dot size-1.5 rounded-full bg-up" />
              <span>Global Uptime &amp; Incident Platform</span>
            </div>

            <h1 className="mt-5 font-[family-name:var(--font-display)] text-4xl font-semibold tracking-tight sm:text-6xl text-text leading-[1.1]">
              Know your stack is up before your customers notice downtime.
            </h1>

            <p className="mt-6 text-lg leading-relaxed text-muted max-w-2xl">
              Real-time multi-region monitoring, automated incident triage, team on-call escalation policies, and white-labeled status pages for engineering teams that cannot afford downtime.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <ButtonLink href="/sign-up" size="lg" className="px-6">
                Start monitoring free
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="secondary" size="lg">
                View live demo
              </ButtonLink>
            </div>
          </div>

          <div className="mt-14 max-w-3xl">
            <PulseLine />
          </div>
        </section>

        {/* Live Probe Grid Preview */}
        <section className="border-y border-line-soft bg-panel/60 py-12">
          <div className="mx-auto w-full max-w-6xl px-6">
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-[family-name:var(--font-display)] text-lg font-semibold text-text">
                  Global Distributed Telemetry
                </p>
                <p className="mt-1 text-xs text-muted">
                  Sub-second regional health probes running continuously across tier-1 edge nodes.
                </p>
              </div>
              <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-xs text-up">
                <span className="status-dot size-2 rounded-full bg-up" />
                <span>ALL PROBE REGIONS OPERATIONAL</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {REGIONS.map((r) => (
                <div
                  key={r.code}
                  className="flex flex-col rounded-lg border border-line-soft bg-panel-2 p-3.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-[family-name:var(--font-mono)] text-xs uppercase font-medium text-text">
                      {r.code}
                    </span>
                    <span className="size-1.5 rounded-full bg-up" />
                  </div>
                  <span className="mt-2 text-xs text-muted truncate">{r.name}</span>
                  <span className="mt-1 font-[family-name:var(--font-mono)] text-[11px] text-brand">
                    {r.ping}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Core Features */}
        <section className="mx-auto w-full max-w-6xl px-6 py-20">
          <div className="max-w-xl">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight text-text sm:text-3xl">
              Engineered for mission-critical reliability
            </h2>
            <p className="mt-2 text-sm text-muted">
              Everything required to safeguard your production services from silent outages.
            </p>
          </div>

          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feat) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="flex flex-col gap-3 rounded-lg border border-line-soft bg-panel p-6 shadow-sm transition-colors hover:border-brand/40"
                >
                  <div className="grid size-10 place-items-center rounded-md border border-brand/30 bg-brand/10 text-brand">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="font-[family-name:var(--font-display)] text-base font-semibold text-text">
                    {feat.title}
                  </h3>
                  <p className="text-xs leading-relaxed text-muted">
                    {feat.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* CTA Card */}
        <section className="mx-auto w-full max-w-6xl px-6 pb-20">
          <div className="rounded-xl border border-brand/40 bg-brand/5 p-8 sm:p-12 text-center flex flex-col items-center">
            <div className="grid size-12 place-items-center rounded-full border border-brand/40 bg-brand/10 text-brand mb-4">
              <ShieldCheck className="size-6" />
            </div>
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl text-text">
              Guard your production infrastructure today.
            </h2>
            <p className="mt-3 max-w-md text-sm text-muted">
              Set up your first monitor in under 60 seconds with zero credit card required.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <ButtonLink href="/sign-up" size="lg">
                Create free organization
              </ButtonLink>
              <ButtonLink href="/sign-in" variant="ghost" size="lg">
                Sign in to existing account
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-line-soft py-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row text-xs text-muted">
          <div className="flex items-center gap-2 font-[family-name:var(--font-display)] font-semibold text-text">
            <span className="grid size-6 place-items-center rounded border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-[10px] text-brand">
              BU
            </span>
            Backend Uptime
          </div>
          <div className="flex items-center gap-6">
            <Link href="/sign-in" className="hover:text-text">
              Sign In
            </Link>
            <Link href="/sign-up" className="hover:text-text">
              Sign Up
            </Link>
          </div>
          <p>© {new Date().getFullYear()} Backend Uptime. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
