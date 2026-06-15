import type { PrismaClient, RotationType } from "@backend-uptime/db";

const PERIOD_DAYS: Record<RotationType, number> = { DAILY: 1, WEEKLY: 7, BIWEEKLY: 14, CUSTOM: 7 };
const DAY_MS = 86_400_000;

export interface ParticipantRef {
  userId: string;
  position: number;
}

export interface OverrideRef {
  userId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface ScheduleForResolve {
  timezone: string;
  rotationType: RotationType;
  handoffMinute: number;
  participants: ParticipantRef[];
  overrides: OverrideRef[];
}

export interface OnCallResult {
  primaryUserId: string | null;
  secondaryUserId: string | null;
  source: "override" | "rotation" | "empty";
}

/**
 * Milliseconds to add to a UTC instant to get the wall-clock time in `tz`,
 * DST-aware at that instant. Uses Intl (no tz library dependency). Falls back to
 * 0 (UTC) for an unknown timezone.
 */
export function tzOffsetMs(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return asUtc - date.getTime();
  } catch {
    return 0;
  }
}

/**
 * The rotation index for `now`: the number of whole rotation periods elapsed
 * (boundaries land at `handoffMinute` local time, in the schedule's timezone),
 * modulo the participant count. Returns -1 when there are no participants.
 */
export function rotationIndex(schedule: ScheduleForResolve, now: Date): number {
  const n = schedule.participants.length;
  if (n === 0) return -1;
  const periodMs = (PERIOD_DAYS[schedule.rotationType] ?? 7) * DAY_MS;
  const localMs = now.getTime() + tzOffsetMs(now, schedule.timezone);
  const shifted = localMs - schedule.handoffMinute * 60_000;
  const periods = Math.floor(shifted / periodMs);
  return ((periods % n) + n) % n;
}

/**
 * Resolve who is on call for a schedule at `now`. An active override takes
 * precedence as the primary responder (with the rotation's current responder as
 * the secondary backup); otherwise the rotation determines primary (current
 * slot) and secondary (next slot). Pure — accepts already-loaded data.
 */
export function resolveOnCall(schedule: ScheduleForResolve, now: Date): OnCallResult {
  const sorted = [...schedule.participants].sort((a, b) => a.position - b.position);
  const override = schedule.overrides.find(
    (o) => o.startsAt.getTime() <= now.getTime() && now.getTime() <= o.endsAt.getTime(),
  );

  if (sorted.length === 0 && !override) {
    return { primaryUserId: null, secondaryUserId: null, source: "empty" };
  }

  const idx = sorted.length > 0 ? rotationIndex({ ...schedule, participants: sorted }, now) : -1;
  const rotationPrimary = idx >= 0 ? (sorted[idx]?.userId ?? null) : null;
  const rotationSecondary =
    idx >= 0 && sorted.length > 1 ? (sorted[(idx + 1) % sorted.length]?.userId ?? null) : null;

  if (override) {
    const secondary =
      rotationPrimary && rotationPrimary !== override.userId ? rotationPrimary : rotationSecondary;
    return { primaryUserId: override.userId, secondaryUserId: secondary, source: "override" };
  }
  return { primaryUserId: rotationPrimary, secondaryUserId: rotationSecondary, source: "rotation" };
}

export interface ResolvedOnCall extends OnCallResult {
  scheduleId: string;
}

/** Load a schedule (participants + active overrides) and resolve who is on call. */
export async function whoIsOnCall(
  prisma: PrismaClient,
  scheduleId: string,
  now: Date = new Date(),
): Promise<ResolvedOnCall | null> {
  const schedule = await prisma.onCallSchedule.findFirst({
    where: { id: scheduleId, deletedAt: null },
    select: {
      timezone: true,
      rotationType: true,
      handoffMinute: true,
      participants: { select: { userId: true, position: true } },
      overrides: {
        where: { startsAt: { lte: now }, endsAt: { gte: now } },
        select: { userId: true, startsAt: true, endsAt: true },
      },
    },
  });
  if (!schedule) return null;
  return { scheduleId, ...resolveOnCall(schedule, now) };
}
