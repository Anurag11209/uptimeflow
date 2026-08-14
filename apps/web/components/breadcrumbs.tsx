"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { useBreadcrumbLabels } from "@/components/breadcrumb-context";

/** Static labels for known route segments. Anything else is humanized or, for
 * a dynamic [id] segment, looked up in the breadcrumb label context. */
const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Overview",
  monitors: "Monitors",
  incidents: "Incidents",
  analytics: "Analytics",
  maintenance: "Maintenance",
  "status-pages": "Status pages",
  settings: "Settings",
  new: "New",
  members: "Members",
  "alert-channels": "Alert channels",
  "api-keys": "API keys",
  "audit-logs": "Audit logs",
  domains: "Domains",
  "escalation-policies": "Escalation policies",
  integrations: "Integrations",
  "oncall-schedules": "On-call schedules",
  organization: "Organization",
  profile: "Profile",
  security: "Security",
  billing: "Billing",
};

/** Heuristic for "this segment is a database ID, not a route name" — used to
 * show a neutral placeholder until a page registers a real label. */
function looksLikeId(segment: string): boolean {
  return /^[a-z0-9]{20,}$/i.test(segment) || /^[0-9a-f-]{8,}$/i.test(segment);
}

export function Breadcrumbs() {
  const pathname = usePathname();
  const labels = useBreadcrumbLabels();

  const segments = pathname.split("/").filter(Boolean);
  // Root "Overview" is implied by the first segment already; skip rendering a
  // trail at all when we're already there.
  if (segments.length <= 1) return null;

  let href = "";
  const crumbs = segments.map((segment, i) => {
    href += `/${segment}`;
    const isLast = i === segments.length - 1;
    const label =
      labels[segment] ??
      SEGMENT_LABELS[segment] ??
      (looksLikeId(segment) ? "…" : humanize(segment));
    return { href, label, isLast };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm text-muted">
      {crumbs.map((c) => (
        <span key={c.href} className="flex items-center gap-1.5">
          {c.isLast ? (
            <span className="max-w-[16rem] truncate text-text" aria-current="page">
              {c.label}
            </span>
          ) : (
            <Link href={c.href} className="truncate hover:text-brand">
              {c.label}
            </Link>
          )}
          {!c.isLast ? <ChevronRight className="size-3.5 shrink-0 text-muted/60" /> : null}
        </span>
      ))}
    </nav>
  );
}

function humanize(segment: string): string {
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
