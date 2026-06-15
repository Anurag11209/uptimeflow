"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Activity, Plug, ShieldCheck, Users } from "lucide-react";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { useSession } from "@/lib/auth-client";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Activity, exact: true },
  { href: "/dashboard/settings/members", label: "Members", icon: Users },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/settings/security", label: "Security", icon: ShieldCheck },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { data: me } = useMe();

  // Client-side guard backing the cookie middleware: bounce out if the
  // session resolves to nothing.
  useEffect(() => {
    if (!isPending && !session) {
      router.replace("/sign-in");
    }
  }, [isPending, session, router]);

  // No organization yet → force creation before the dashboard renders.
  useEffect(() => {
    if (me && me.memberships.length === 0) {
      router.replace("/create-organization");
    }
  }, [me, router]);

  if (isPending || !session) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="size-6 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line-soft bg-ink/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 font-[family-name:var(--font-display)] font-semibold"
            >
              <span className="grid size-8 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-xs text-brand">
                BU
              </span>
              <span className="hidden sm:inline">Backend Uptime</span>
            </Link>
            <OrgSwitcher activeOrgId={me?.activeOrganizationId ?? null} />
          </div>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted md:inline">
              {session.user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl gap-8 px-6 py-8">
        <nav className="hidden w-48 shrink-0 flex-col gap-1 md:flex">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-panel text-text"
                    : "text-muted hover:bg-panel/60 hover:text-text",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
