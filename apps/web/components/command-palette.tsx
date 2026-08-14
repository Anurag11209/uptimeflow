"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  LayoutPanelTop,
  Radar,
  Search,
  Settings,
  Siren,
  Wrench,
} from "lucide-react";
import { HealthBadge } from "@/components/monitors/health-badge";
import { useActiveOrg } from "@/lib/queries";
import { monitorTarget, useMonitors, type MonitorListItem } from "@/lib/monitors";
import { cn } from "@/lib/utils";

interface Command {
  id: string;
  label: string;
  sublabel?: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords?: string;
}

const NAV_COMMANDS: Command[] = [
  { id: "nav-overview", label: "Overview", href: "/dashboard", icon: Activity },
  { id: "nav-monitors", label: "Monitors", href: "/dashboard/monitors", icon: Radar },
  { id: "nav-incidents", label: "Incidents", href: "/dashboard/incidents", icon: Siren },
  { id: "nav-analytics", label: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { id: "nav-maintenance", label: "Maintenance", href: "/dashboard/maintenance", icon: Wrench },
  {
    id: "nav-status-pages",
    label: "Status pages",
    href: "/dashboard/status-pages",
    icon: LayoutPanelTop,
  },
  { id: "nav-settings", label: "Settings", href: "/dashboard/settings", icon: Settings },
  {
    id: "nav-new-monitor",
    label: "New monitor",
    href: "/dashboard/monitors/new",
    icon: Radar,
    keywords: "create add",
  },
];

/**
 * Global Cmd/Ctrl+K palette: jump to any nav section or search monitors by
 * name/target. Deliberately dependency-free (no cmdk) — a controlled input
 * plus a filtered, keyboard-navigable list is enough at this scale.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const { data: activeOrg } = useActiveOrg();
  const orgId = activeOrg?.organization.id;
  const { data: monitorPage } = useMonitors(orgId);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (isCmdK) {
        e.preventDefault();
        onOpenChange(!open);
      } else if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      // Wait a frame so the input exists before focusing.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const monitorCommands: Command[] = useMemo(
    () =>
      (monitorPage?.items ?? []).map((m: MonitorListItem) => ({
        id: `monitor-${m.id}`,
        label: m.name,
        sublabel: monitorTarget(m),
        href: `/dashboard/monitors/${m.id}`,
        icon: Radar,
        keywords: monitorTarget(m) ?? undefined,
      })),
    [monitorPage],
  );

  const results = useMemo(() => {
    const all = [...NAV_COMMANDS, ...monitorCommands];
    const q = query.trim().toLowerCase();
    if (!q) return NAV_COMMANDS;
    return all.filter((c) =>
      `${c.label} ${c.sublabel ?? ""} ${c.keywords ?? ""}`.toLowerCase().includes(q),
    );
  }, [query, monitorCommands]);

  useEffect(() => {
    setActiveIndex(0);
  }, [results.length]);

  function go(command: Command) {
    onOpenChange(false);
    router.push(command.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const chosen = results[activeIndex];
      if (chosen) go(chosen);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/70 p-4 pt-[15vh] backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-lg border border-line bg-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search monitors or jump to a page…"
            className="w-full bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
          />
          <kbd className="hidden shrink-0 rounded border border-line-soft px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-muted sm:inline">
            Esc
          </kbd>
        </div>

        <ul className="max-h-80 overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted">No matches.</li>
          ) : (
            results.map((c, i) => {
              const Icon = c.icon;
              const monitor = c.id.startsWith("monitor-")
                ? monitorPage?.items.find((m) => `monitor-${m.id}` === c.id)
                : undefined;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => go(c)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      i === activeIndex ? "bg-panel-2 text-text" : "text-muted hover:text-text",
                    )}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">
                      {c.label}
                      {c.sublabel ? (
                        <span className="ml-2 truncate font-[family-name:var(--font-mono)] text-xs text-muted">
                          {c.sublabel}
                        </span>
                      ) : null}
                    </span>
                    {monitor ? <HealthBadge health={monitor.health} /> : null}
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

/** Small trigger button for the header — shows the shortcut hint. */
export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="hidden items-center gap-2 rounded-md border border-line-soft bg-panel-2/50 px-3 py-1.5 text-xs text-muted transition-colors hover:text-text sm:flex"
    >
      <Search className="size-3.5" />
      Search
      <kbd className="rounded border border-line-soft px-1 font-[family-name:var(--font-mono)] text-[10px]">
        ⌘K
      </kbd>
    </button>
  );
}
