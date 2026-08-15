"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  BarChart3,
  ChevronsLeft,
  ChevronsRight,
  LayoutPanelTop,
  Menu,
  Radar,
  Search,
  Settings,
  Siren,
  Wrench,
  X,
} from "lucide-react";
import { OrgSwitcher } from "@/components/org-switcher";
import { SignOutButton } from "@/components/sign-out-button";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { BreadcrumbProvider } from "@/components/breadcrumb-context";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command-palette";
import { useSession } from "@/lib/auth-client";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: Activity, exact: true },
  { href: "/dashboard/monitors", label: "Monitors", icon: Radar },
  { href: "/dashboard/incidents", label: "Incidents", icon: Siren },
  { href: "/dashboard/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/dashboard/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/dashboard/status-pages", label: "Status pages", icon: LayoutPanelTop },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

const SIDEBAR_COLLAPSE_KEY = "uptimeflow:sidebar-collapsed";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending } = useSession();
  const { data: me } = useMe();

  const [collapsed, setCollapsed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileDrawerRef = useRef<HTMLElement>(null);

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Handle escape key to close mobile drawer
  useEffect(() => {
    if (!mobileNavOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileNavOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  // Trap Tab focus inside the drawer while it's open, and move focus into it
  // on open so keyboard users land somewhere sensible instead of on the page
  // content that's now hidden behind the backdrop.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const panel = mobileDrawerRef.current;
    if (!panel) return;

    function getFocusable(): HTMLElement[] {
      if (!panel) return [];
      return Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
    }

    const focusable = getFocusable();
    (focusable[0] ?? panel).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);

  // Persisted client preference — read after mount to avoid SSR/client
  // markup mismatches (we don't know localStorage during server render).
  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY);
    if (stored === "1") setCollapsed(true);
    setHydrated(true);
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }

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
    <BreadcrumbProvider>
      <div className="min-h-screen">
        {/* Accessible skip link for keyboard & assistive technology users */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-brand focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-xl"
        >
          Skip to main content
        </a>

        <header className="sticky top-0 z-30 border-b border-line-soft bg-ink/80 backdrop-blur">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-3 sm:gap-4">
              {/* Mobile menu hamburger toggle */}
              <button
                type="button"
                onClick={() => setMobileNavOpen((v) => !v)}
                aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={mobileNavOpen}
                className="grid size-9 place-items-center rounded-md border border-line-soft bg-panel-2 text-muted transition-colors hover:text-text md:hidden"
              >
                {mobileNavOpen ? <X className="size-4" /> : <Menu className="size-4" />}
              </button>

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

            <div className="flex items-center gap-2 sm:gap-3">
              {/* Mobile search trigger */}
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                aria-label="Open command palette search"
                className="grid size-9 place-items-center rounded-md border border-line-soft bg-panel-2/50 text-muted transition-colors hover:text-text sm:hidden"
              >
                <Search className="size-4" />
              </button>

              <CommandPaletteTrigger onClick={() => setPaletteOpen(true)} />
              <span className="hidden text-sm text-muted md:inline">{session.user.email}</span>
              <SignOutButton />
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {mobileNavOpen ? (
          <div
            className="fixed inset-0 z-40 bg-ink/70 backdrop-blur-sm md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          >
            <aside
              ref={mobileDrawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Mobile navigation"
              tabIndex={-1}
              className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-1 border-r border-line-soft bg-panel p-4 shadow-2xl focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between border-b border-line-soft pb-3">
                <div className="flex items-center gap-2 font-[family-name:var(--font-display)] text-sm font-semibold">
                  <span className="grid size-7 place-items-center rounded-md border border-brand/50 bg-brand/10 font-[family-name:var(--font-mono)] text-xs text-brand">
                    BU
                  </span>
                  Backend Uptime
                </div>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-text"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                {NAV.map((item) => {
                  const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3.5 py-2.5 text-sm transition-colors",
                        active
                          ? "bg-panel-2 font-medium text-text border border-line-soft"
                          : "text-muted hover:bg-panel-2/60 hover:text-text",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="border-t border-line-soft pt-3 text-xs text-muted">
                Signed in as <span className="text-text font-mono truncate block">{session.user.email}</span>
              </div>
            </aside>
          </div>
        ) : null}

        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />

        <div className="mx-auto flex w-full max-w-6xl gap-8 px-4 py-8 sm:px-6">
          <nav
            aria-label="Main navigation"
            className={cn(
              "hidden shrink-0 flex-col gap-1 md:flex",
              hydrated ? "transition-[width] duration-150" : undefined,
              collapsed ? "w-14" : "w-48",
            )}
          >
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active ? "bg-panel text-text" : "text-muted hover:bg-panel/60 hover:text-text",
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className={cn("truncate", collapsed && "sr-only")}>{item.label}</span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={toggleCollapsed}
              className="mt-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted transition-colors hover:bg-panel/60 hover:text-text"
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <ChevronsRight className="size-4 shrink-0" />
              ) : (
                <>
                  <ChevronsLeft className="size-4 shrink-0" />
                  <span className="truncate text-xs">Collapse</span>
                </>
              )}
            </button>
          </nav>

          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
            <Breadcrumbs />
            {children}
          </main>
        </div>
      </div>
    </BreadcrumbProvider>
  );
}

