"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  CreditCard,
  Globe,
  KeyRound,
  Plug,
  ScrollText,
  ShieldCheck,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SETTINGS_NAV = [
  { href: "/dashboard/settings/organization", label: "Organization", icon: Building2 },
  { href: "/dashboard/settings/members", label: "Members", icon: Users },
  { href: "/dashboard/settings/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/settings/integrations", label: "Integrations", icon: Plug },
  { href: "/dashboard/settings/domains", label: "Domains", icon: Globe },
  { href: "/dashboard/settings/audit-logs", label: "Audit logs", icon: ScrollText },
  { href: "/dashboard/settings/profile", label: "Profile", icon: UserCog },
  { href: "/dashboard/settings/security", label: "Security", icon: ShieldCheck },
  { href: "/dashboard/billing", label: "Billing", icon: CreditCard },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted">
          Manage your organization, team, security, and integrations.
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <nav
          aria-label="Settings"
          className="flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-visible"
        >
          {SETTINGS_NAV.map((item) => {
            const active = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-panel text-text"
                    : "text-muted hover:bg-panel/60 hover:text-text",
                )}
              >
                <Icon className="size-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
