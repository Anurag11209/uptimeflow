/**
 * Pure incident aggregations for the dashboard widgets. No React — unit-tested.
 */

import type { IncidentListItem } from "@/lib/monitors";

/** Unresolved incidents (open or acknowledged). */
export function countUnresolved(incidents: IncidentListItem[]): number {
  return incidents.filter((i) => i.status !== "RESOLVED").length;
}

export function countByStatus(
  incidents: IncidentListItem[],
  status: IncidentListItem["status"],
): number {
  return incidents.filter((i) => i.status === status).length;
}

/** Incidents started since local midnight. */
export function countToday(
  incidents: IncidentListItem[],
  now: number = Date.now(),
): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const start = midnight.getTime();
  return incidents.filter((i) => new Date(i.startedAt).getTime() >= start).length;
}

/** Mean time to recovery (seconds) over resolved incidents with a duration. */
export function meanTimeToRecovery(incidents: IncidentListItem[]): number | null {
  const durations = incidents
    .filter((i) => i.status === "RESOLVED" && i.durationSec !== null)
    .map((i) => i.durationSec as number);
  if (durations.length === 0) return null;
  return Math.round(
    durations.reduce((sum, d) => sum + d, 0) / durations.length,
  );
}

/** Most recently resolved incidents, newest first. */
export function recentRecoveries(
  incidents: IncidentListItem[],
  limit = 5,
): IncidentListItem[] {
  return incidents
    .filter((i) => i.status === "RESOLVED" && i.resolvedAt)
    .sort(
      (a, b) =>
        new Date(b.resolvedAt as string).getTime() -
        new Date(a.resolvedAt as string).getTime(),
    )
    .slice(0, limit);
}

/** Count of incidents at CRITICAL or MAJOR severity that are unresolved. */
export function countCritical(incidents: IncidentListItem[]): number {
  return incidents.filter(
    (i) =>
      i.status !== "RESOLVED" &&
      (i.severity === "CRITICAL" || i.severity === "MAJOR"),
  ).length;
}
