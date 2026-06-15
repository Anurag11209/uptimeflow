import type { Probe, ProbeSignal } from "../types.js";

/** Extra slack beyond the interval before a missed heartbeat counts as down. */
export const HEARTBEAT_GRACE_MS = 60_000;

/**
 * Heartbeat (dead-man's-switch) probe. Heartbeats are push-based: the monitored
 * job calls the ingest endpoint, which stamps `lastCheckedAt`. This probe makes
 * no network call — it evaluates freshness: a ping is expected every
 * `intervalSeconds` (+ grace); if the last ping is older than that, the job is
 * considered DOWN (overdue).
 */
export const heartbeatProbe: Probe = async (monitor, ctx) => {
  if (!monitor.lastCheckedAt) {
    return { reachable: false, responseMs: 0, errorType: "no_ping", errorMessage: "No heartbeat received yet." };
  }

  const ageMs = ctx.now.getTime() - monitor.lastCheckedAt.getTime();
  const deadlineMs = monitor.intervalSeconds * 1000 + HEARTBEAT_GRACE_MS;

  if (ageMs > deadlineMs) {
    return {
      reachable: false,
      responseMs: ageMs,
      errorType: "timeout",
      errorMessage: `No heartbeat for ${Math.round(ageMs / 1000)}s (expected every ${monitor.intervalSeconds}s).`,
    };
  }
  return { reachable: true, responseMs: ageMs };
};
