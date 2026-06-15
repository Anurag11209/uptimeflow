import type { PrismaClient } from "@backend-uptime/db";

/** Sliding window over which repeated incidents count as flapping. */
export const FLAP_WINDOW_MS = 30 * 60 * 1000;
/** Number of incidents within the window that marks a monitor as flapping. */
export const FLAP_THRESHOLD = 3;

/**
 * Flapping detection: a monitor is flapping when it has opened too many
 * incidents in a short window (rapid down/up oscillation). The incidents table
 * is low-volume (one row per outage, not per check), so this count is cheap and
 * indexed by (monitorId, startedAt). Callers use it to deduplicate alerts —
 * the incident is still recorded, but a fresh notification is suppressed.
 */
export async function detectFlapping(
  prisma: PrismaClient,
  monitorId: string,
  now: Date,
  windowMs: number = FLAP_WINDOW_MS,
  threshold: number = FLAP_THRESHOLD,
): Promise<boolean> {
  const since = new Date(now.getTime() - windowMs);
  const recent = await prisma.incident.count({
    where: { monitorId, startedAt: { gte: since } },
  });
  return recent >= threshold;
}
