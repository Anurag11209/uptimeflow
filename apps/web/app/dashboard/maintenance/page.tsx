"use client";

import { useState } from "react";
import { Wrench, Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useActiveOrg } from "@/lib/queries";
import { useMonitors } from "@/lib/monitors";
import {
  useMaintenanceWindows,
  useInvalidateMaintenanceWindows,
  createWindow,
  deleteWindow,
  windowStatus,
  fmtDateRange,
  type MaintenanceWindow,
  type CreateMaintenanceWindowInput,
} from "@/lib/maintenance-windows";
import type { MonitorListItem } from "@/lib/monitors";
// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns a datetime-local string (YYYY-MM-DDTHH:MM) offset by `hours` from now. */
function nowPlusHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);
}

/** Converts a datetime-local value to a full ISO 8601 string for the API. */
function toIso(datetimeLocal: string): string {
  return new Date(datetimeLocal).toISOString();
}

// ─── Status badge ─────────────────────────────────────────────────────────────

function WindowStatusBadge({ window: w }: { window: MaintenanceWindow }) {
  const status = windowStatus(w);
  const config = {
    active: { tone: "brand" as const, label: "Active" },
    upcoming: { tone: "muted" as const, label: "Upcoming" },
    past: { tone: "muted" as const, label: "Past" },
  }[status];
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

// ─── Create dialog ────────────────────────────────────────────────────────────

interface CreateDialogProps {
  orgId: string;
  onClose: () => void;
  onCreated: () => void;
}

function CreateWindowDialog({ orgId, onClose, onCreated }: CreateDialogProps) {
  // Initialise with sensible defaults so the inputs aren't empty on open
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(nowPlusHours(1));
  const [endsAt, setEndsAt] = useState(nowPlusHours(2));
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: monitorsData } = useMonitors(orgId);
  const monitors: MonitorListItem[] = monitorsData?.items ?? [];

  function toggleMonitor(id: string) {
    setSelectedMonitorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  const handleSubmit: React.SubmitEventHandler<HTMLFormElement> = async (e) => {
    e.preventDefault();
    setError(null);

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (start >= end) {
      setError("End time must be after start time.");
      return;
    }

    setPending(true);
    try {
      await createWindow(orgId, {
        title: title.trim(),
        description: description.trim() || undefined,
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
        monitorIds: selectedMonitorIds,
      } satisfies CreateMaintenanceWindowInput);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create maintenance window.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/80 px-4 py-10 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-line bg-panel shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line-soft p-5">
          <h2 className="font-[family-name:var(--font-display)] text-base font-semibold text-text">
            Schedule maintenance window
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted transition-colors hover:bg-panel-2 hover:text-text"
          >
            <svg className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 p-5">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="mw-title">Title *</Label>
            <Input
              id="mw-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Database migration"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="mw-desc">Description</Label>
            <textarea
              id="mw-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional note about this window"
              className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-sm text-text placeholder:text-muted/40 focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
            />
          </div>

          {/* Start / end — controlled with state initialised to sensible defaults */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mw-start">Starts at *</Label>
              <input
                id="mw-start"
                type="datetime-local"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-text focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mw-end">Ends at *</Label>
              <input
                id="mw-end"
                type="datetime-local"
                required
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="h-10 w-full rounded-md border border-line bg-panel-2 px-3 text-sm text-text focus-visible:border-brand/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40"
              />
            </div>
          </div>

          {/* Monitor multi-select */}
          <div className="space-y-1.5">
            <Label>Affected monitors</Label>
            <p className="text-xs text-muted">
              Alerts for selected monitors are suppressed during this window.
            </p>
            {monitors.length === 0 ? (
              <p className="text-xs text-muted/60">No monitors found — create one first.</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-md border border-line bg-panel-2">
                {monitors.map((m) => (
                  <label
                    key={m.id}
                    className="flex cursor-pointer items-center gap-3 border-b border-line-soft px-4 py-2.5 text-sm last:border-b-0 hover:bg-panel transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedMonitorIds.includes(m.id)}
                      onChange={() => toggleMonitor(m.id)}
                      className="rounded border-line accent-brand"
                    />
                    <span className="text-text">{m.name}</span>
                    <span className="ml-auto font-[family-name:var(--font-mono)] text-[10px] uppercase text-muted">
                      {m.type}
                    </span>
                  </label>
                ))}
              </div>
            )}
            {selectedMonitorIds.length > 0 && (
              <p className="text-xs text-muted">
                {selectedMonitorIds.length} monitor
                {selectedMonitorIds.length !== 1 ? "s" : ""} selected
              </p>
            )}
          </div>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="flex justify-end gap-3 border-t border-line-soft pt-5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Schedule window
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Window row ───────────────────────────────────────────────────────────────

interface WindowRowProps {
  window: MaintenanceWindow;
  onCancel: () => void;
  busy: boolean;
}

function WindowRow({ window: w, onCancel, busy }: WindowRowProps) {
  const isPast = windowStatus(w) === "past";

  return (
    <div className="flex flex-col gap-2 border-b border-line-soft px-5 py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text">{w.title}</span>
          <WindowStatusBadge window={w} />
        </div>

        <p className="font-[family-name:var(--font-mono)] text-xs text-muted">
          {fmtDateRange(w.startsAt, w.endsAt)}
        </p>

        {w.description && <p className="text-xs text-muted">{w.description}</p>}

        {w.monitors.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {w.monitors.map((m) => (
              <Badge key={m.id} tone="muted">
                {m.name}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {!isPast && (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onCancel}
          className="shrink-0"
        >
          Cancel window
        </Button>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MaintenanceWindowsPage() {
  const { data: activeOrg, isPending: orgPending } = useActiveOrg();
  const orgId = activeOrg?.organization.id;

  const { data, isPending: listPending } = useMaintenanceWindows(orgId);
  const invalidate = useInvalidateMaintenanceWindows();

  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // data is MaintenanceWindow[] | undefined — default to empty array
  const allWindows: MaintenanceWindow[] = data ?? [];
  const upcoming = allWindows.filter((w) => windowStatus(w) !== "past");
  const past = allWindows.filter((w) => windowStatus(w) === "past");

  async function onCancel(id: string) {
    if (!orgId) return;
    setBusyId(id);
    setError(null);
    try {
      await deleteWindow(orgId, id);
      invalidate(orgId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel window.");
    } finally {
      setBusyId(null);
      setConfirmCancelId(null);
    }
  }

  if (orgPending) {
    return <div className="h-64 animate-pulse rounded-lg bg-panel" />;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold text-text">
            Maintenance Windows
          </h1>
          <p className="mt-0.5 text-sm text-muted">Suppress alerts during planned outages</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="size-4" />
          Schedule window
        </Button>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      {/* Loading skeleton */}
      {listPending && (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-panel" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!listPending && allWindows.length === 0 && (
        <Card className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <Wrench className="size-10 text-muted/40" />
          <p className="font-[family-name:var(--font-display)] text-sm font-medium text-text">
            No maintenance windows
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-muted">
            Schedule a window before planned work starts — alerts on affected monitors will be
            suppressed automatically.
          </p>
          <Button size="sm" onClick={() => setShowCreate(true)} className="mt-2">
            <Plus className="size-4" />
            Schedule your first window
          </Button>
        </Card>
      )}

      {/* Upcoming & active */}
      {!listPending && upcoming.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-muted">
            Upcoming &amp; active
          </h2>
          <Card>
            {upcoming.map((w) => (
              <WindowRow
                key={w.id}
                window={w}
                busy={busyId === w.id}
                onCancel={() => setConfirmCancelId(w.id)}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Past */}
      {!listPending && past.length > 0 && (
        <div className="space-y-3">
          <h2 className="font-[family-name:var(--font-mono)] text-xs uppercase tracking-wider text-muted">
            Past
          </h2>
          <Card className="opacity-60">
            {past.map((w) => (
              <WindowRow
                key={w.id}
                window={w}
                busy={busyId === w.id}
                onCancel={() => setConfirmCancelId(w.id)}
              />
            ))}
          </Card>
        </div>
      )}

      {/* Create dialog */}
      {showCreate && orgId && (
        <CreateWindowDialog
          orgId={orgId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidate(orgId);
          }}
        />
      )}

      {/* Cancel confirm dialog */}
      {confirmCancelId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-line bg-panel p-6 shadow-2xl">
            <h2 className="font-[family-name:var(--font-display)] font-semibold text-text">
              Cancel this window?
            </h2>
            <p className="mt-2 text-sm text-muted">
              Alerts will resume on affected monitors immediately after cancellation.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setConfirmCancelId(null)}>
                Keep window
              </Button>
              <Button
                variant="danger"
                loading={busyId === confirmCancelId}
                onClick={() => onCancel(confirmCancelId)}
              >
                Cancel window
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
