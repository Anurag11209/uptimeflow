import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PulseLine } from "@/components/pulse-line";

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line-soft">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
          <div className="flex items-center gap-3 font-[family-name:var(--font-display)] font-semibold">
            <span className="grid size-8 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-xs text-brand">
              BU
            </span>
            Backend Uptime
          </div>
          <nav className="flex items-center gap-2">
            <Link href="/sign-in">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link href="/sign-up">
              <Button size="sm">Get started</Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex flex-1 items-center">
        <div className="mx-auto w-full max-w-5xl px-6 py-20">
          <p className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-widest text-brand">
            Phase 1 · Auth &amp; Organizations
          </p>
          <h1 className="mt-4 max-w-2xl font-[family-name:var(--font-display)] text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Know your stack is up before your customers know it&apos;s down.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
            Backend Uptime is a global monitoring platform: multi-region
            checks, incident management, on-call alerting, and public status
            pages. This build ships the foundation — accounts, organizations,
            roles, and invitations.
          </p>
          <div className="mt-8 flex items-center gap-3">
            <Link href="/sign-up">
              <Button size="lg">Create your organization</Button>
            </Link>
            <Link href="/sign-in">
              <Button variant="secondary" size="lg">
                Sign in
              </Button>
            </Link>
          </div>
          <div className="mt-16 max-w-2xl">
            <PulseLine />
          </div>
        </div>
      </main>
    </div>
  );
}
