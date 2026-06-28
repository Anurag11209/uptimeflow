import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  componentStatusMeta,
  formatUptime,
  incidentStatusLabel,
  isAllOperational,
  overallHeadline,
  safeAccent,
  uptimeBarColor,
  uptimeTone,
  type PublicStatusComponent,
  type PublicStatusIncident,
  type PublicStatusPage,
  type StatusHistory,
  type StatusHistoryComponent,
} from "@/lib/status";
import { fetchStatusHistory, fetchStatusIncidents, fetchStatusPage } from "@/lib/status-api";
import { SubscribeForm } from "./subscribe-form";

interface PageProps {
  params: Promise<{ slug: string }>;
}

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = await fetchStatusPage(slug);
  if (!page) return { title: "Status page not found", robots: { index: false } };

  const title = `${page.name} Status`;
  const description =
    page.description ?? `Live status, uptime, and incident history for ${page.name}.`;
  const url = APP_URL ? `${APP_URL}/status/${page.slug}` : "";
  const favicon = page.branding?.faviconUrl ?? undefined;

  return {
    title,
    description,
    metadataBase: APP_URL ? new URL(APP_URL) : undefined,
    alternates: url ? { canonical: url } : undefined,
    icons: favicon ? { icon: favicon } : undefined,
    robots: { index: true, follow: true },
    openGraph: {
      type: "website",
      title,
      description,
      url: url || undefined,
      siteName: page.name,
      images: page.branding?.logoUrl ? [{ url: page.branding.logoUrl }] : undefined,
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: page.branding?.logoUrl ? [page.branding.logoUrl] : undefined,
    },
  };
}

export default async function StatusPage({ params }: PageProps) {
  const { slug } = await params;
  const page = await fetchStatusPage(slug);
  if (!page) notFound();

  // Supplementary data — degrade gracefully if these fail.
  const [history, incidents] = await Promise.all([
    fetchStatusHistory(slug).catch(() => null),
    fetchStatusIncidents(slug).catch(() => null),
  ]);
  const historyById = new Map((history?.components ?? []).map((c) => [c.id, c]));
  const resolved = (incidents?.items ?? []).filter((i) => i.resolvedAt !== null).slice(0, 10);

  // Maintenance is modeled as an incident with MAINTENANCE impact; surface it in
  // its own section rather than alongside outages.
  const activeIncidents = page.activeIncidents.filter((i) => i.impact !== "MAINTENANCE");
  const maintenance = page.activeIncidents.filter((i) => i.impact === "MAINTENANCE");

  const tz = page.branding?.timezone ?? "UTC";
  const accent = safeAccent(page.branding?.accent);
  // Re-theme the brand accent for this page only (cascades to brand-toned UI).
  const accentStyle = accent ? ({ "--color-brand": accent } as React.CSSProperties) : undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: `${page.name} Status`,
    description: page.description ?? `Live status and uptime for ${page.name}.`,
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:py-14" style={accentStyle}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Hero page={page} overallUptime={history?.overallUptimePct ?? null} />
      <div className="mt-8 flex flex-col gap-8">
        {activeIncidents.length > 0 ? <ActiveIncidents incidents={activeIncidents} tz={tz} /> : null}
        {maintenance.length > 0 ? <MaintenanceSection incidents={maintenance} tz={tz} /> : null}
        <Components components={page.components} historyById={historyById} />
        {history ? <UptimeSection history={history} /> : null}
        {resolved.length > 0 ? <IncidentHistory incidents={resolved} tz={tz} /> : null}
        <SubscribeSection slug={page.slug} />
      </div>
      <Footer page={page} tz={tz} />
    </main>
  );
}

function Footer({ page, tz }: { page: PublicStatusPage; tz: string }) {
  const links = page.branding?.socialLinks ?? [];
  return (
    <footer className="mt-12 flex flex-col items-center gap-3 text-center text-xs text-muted">
      {links.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-4">
          {links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="hover:text-brand">
              {l.label}
            </a>
          ))}
        </div>
      ) : null}
      {page.branding?.footerText ? <p className="text-text/80">{page.branding.footerText}</p> : null}
      <p>Powered by UptimeFlow · Updated {formatDateTime(page.updatedAt, tz)}</p>
    </footer>
  );
}

// ───────────────────────────────── Hero ─────────────────────────────────────

function Hero({ page, overallUptime }: { page: PublicStatusPage; overallUptime: number | null }) {
  const ok = isAllOperational(page.overallStatus);
  const meta = componentStatusMeta(page.overallStatus);
  return (
    <header>
      <div className="flex items-center gap-3 text-sm text-muted">
        {page.branding?.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.branding.logoUrl}
            alt={`${page.name} logo`}
            className="h-8 w-auto max-w-[180px] object-contain"
          />
        ) : (
          <span className="font-[family-name:var(--font-mono)] uppercase tracking-wide">
            {page.name}
          </span>
        )}
      </div>
      <h1 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-semibold text-text sm:text-3xl">
        {page.description ?? `${page.name} status`}
      </h1>

      <div
        className={cn(
          "mt-6 flex items-center justify-between gap-4 rounded-lg border p-5",
          ok ? "border-up/40 bg-up/5" : "border-warn/40 bg-warn/5",
        )}
      >
        <div className="flex items-center gap-3">
          <StatusDot status={page.overallStatus} pulse />
          <p className="text-lg font-medium text-text">{overallHeadline(page.overallStatus)}</p>
        </div>
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </div>

      {overallUptime !== null ? (
        <p className="mt-3 text-sm text-muted">
          <span className={cn("font-semibold", toneText(uptimeTone(overallUptime)))}>
            {formatUptime(overallUptime)}
          </span>{" "}
          uptime over the last 90 days
        </p>
      ) : null}
    </header>
  );
}

function StatusDot({ status, pulse }: { status: PublicStatusComponent["status"]; pulse?: boolean }) {
  const meta = componentStatusMeta(status);
  return (
    <span className="relative inline-flex size-3" aria-hidden>
      {pulse ? (
        <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", meta.dot)} />
      ) : null}
      <span className={cn("relative inline-flex size-3 rounded-full", meta.dot)} />
    </span>
  );
}

// ─────────────────────────────── Components ─────────────────────────────────

function Components({
  components,
  historyById,
}: {
  components: PublicStatusComponent[];
  historyById: Map<string, StatusHistoryComponent>;
}) {
  if (components.length === 0) {
    return (
      <Card>
        <CardContent className="text-sm text-muted">No components configured yet.</CardContent>
      </Card>
    );
  }
  const groups = groupComponents(components);
  return (
    <section aria-labelledby="components-heading">
      <h2 id="components-heading" className="sr-only">
        Components
      </h2>
      <Card>
        <ul className="divide-y divide-line-soft">
          {groups.map(({ group, items }) => (
            <li key={group ?? "_"}>
              {group ? (
                <p className="px-5 pt-4 text-xs font-semibold uppercase tracking-wide text-muted">{group}</p>
              ) : null}
              <ul>
                {items.map((c) => {
                  const meta = componentStatusMeta(c.status);
                  const uptime = historyById.get(c.id)?.uptimePct;
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-4 px-5 py-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <StatusDot status={c.status} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text">{c.name}</p>
                          {c.description ? <p className="truncate text-xs text-muted">{c.description}</p> : null}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        {c.showUptime && uptime !== undefined ? (
                          <span className={cn("text-xs font-medium", toneText(uptimeTone(uptime)))}>
                            {formatUptime(uptime)}
                          </span>
                        ) : null}
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

// ──────────────────────────────── Uptime ────────────────────────────────────

function UptimeSection({ history }: { history: StatusHistory }) {
  const shown = history.components.filter((c) => c.days.length > 0);
  if (shown.length === 0) return null;
  return (
    <section aria-labelledby="uptime-heading">
      <Card>
        <CardHeader>
          <CardTitle id="uptime-heading">Uptime — last {history.windowDays} days</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {shown.map((c) => (
            <div key={c.id}>
              <div className="mb-1.5 flex items-center justify-between text-xs">
                <span className="text-text">{c.name}</span>
                <span className={cn("font-medium", toneText(uptimeTone(c.uptimePct)))}>
                  {formatUptime(c.uptimePct)}
                </span>
              </div>
              <div className="flex h-8 items-stretch gap-px" role="img" aria-label={`${c.name} ${formatUptime(c.uptimePct)} uptime`}>
                {c.days.map((d) => (
                  <span
                    key={d.day}
                    title={`${d.day}: ${formatUptime(d.uptimePct)}`}
                    className={cn("flex-1 rounded-[1px]", uptimeBarColor(d.uptimePct))}
                  />
                ))}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

// ─────────────────────────────── Incidents ──────────────────────────────────

function ActiveIncidents({ incidents, tz }: { incidents: PublicStatusIncident[]; tz: string }) {
  return (
    <section aria-labelledby="active-heading">
      <Card className="border-warn/40">
        <CardHeader>
          <CardTitle id="active-heading">Active incidents</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {incidents.map((incident) => (
            <article key={incident.id}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text">{incident.title}</h3>
                <Badge tone="brand">{incidentStatusLabel(incident.status)}</Badge>
              </div>
              <ol className="mt-3 flex flex-col gap-3 border-l border-line-soft pl-4">
                {incident.updates.map((u, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-warn" aria-hidden />
                    <p className="text-xs font-medium text-muted">
                      {incidentStatusLabel(u.status)} · {formatDateTime(u.createdAt, tz)}
                    </p>
                    <p className="text-sm text-text">{u.body}</p>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function MaintenanceSection({ incidents, tz }: { incidents: PublicStatusIncident[]; tz: string }) {
  return (
    <section aria-labelledby="maintenance-heading">
      <Card>
        <CardHeader>
          <CardTitle id="maintenance-heading">Scheduled maintenance</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {incidents.map((incident) => (
            <article key={incident.id}>
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-text">{incident.title}</h3>
                <Badge tone="muted">{incidentStatusLabel(incident.status)}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted">Starts {formatDateTime(incident.startedAt, tz)}</p>
              <ol className="mt-3 flex flex-col gap-3 border-l border-line-soft pl-4">
                {incident.updates.map((u, i) => (
                  <li key={i} className="relative">
                    <span className="absolute -left-[21px] top-1 size-2 rounded-full bg-muted" aria-hidden />
                    <p className="text-xs font-medium text-muted">
                      {incidentStatusLabel(u.status)} · {formatDateTime(u.createdAt, tz)}
                    </p>
                    <p className="text-sm text-text">{u.body}</p>
                  </li>
                ))}
              </ol>
            </article>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

function IncidentHistory({ incidents, tz }: { incidents: PublicStatusIncident[]; tz: string }) {
  return (
    <section aria-labelledby="history-heading">
      <Card>
        <CardHeader>
          <CardTitle id="history-heading">Past incidents</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-3">
            {incidents.map((incident) => (
              <li key={incident.id} className="flex items-center justify-between gap-4">
                <span className="truncate text-sm text-text">{incident.title}</span>
                <span className="shrink-0 text-xs text-muted">
                  Resolved {incident.resolvedAt ? formatDate(incident.resolvedAt, tz) : ""}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

// ─────────────────────────────── Subscribe ──────────────────────────────────

function SubscribeSection({ slug }: { slug: string }) {
  return (
    <section aria-labelledby="subscribe-heading">
      <Card>
        <CardHeader>
          <CardTitle id="subscribe-heading">Subscribe to updates</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscribeForm slug={slug} />
        </CardContent>
      </Card>
    </section>
  );
}

// ──────────────────────────────── Helpers ───────────────────────────────────

function groupComponents(
  components: PublicStatusComponent[],
): { group: string | null; items: PublicStatusComponent[] }[] {
  const order: (string | null)[] = [];
  const map = new Map<string | null, PublicStatusComponent[]>();
  for (const c of components) {
    const key = c.groupName ?? null;
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(c);
  }
  return order.map((group) => ({ group, items: map.get(group)! }));
}

function toneText(tone: ReturnType<typeof uptimeTone>): string {
  return tone === "up" ? "text-up" : tone === "down" ? "text-down" : tone === "brand" ? "text-warn" : "text-muted";
}

/** Format a timestamp in the page's configured timezone, falling back to UTC. */
function formatDateTime(iso: string, tz = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(iso));
  }
}

function formatDate(iso: string, tz = "UTC"): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(iso));
  }
}
