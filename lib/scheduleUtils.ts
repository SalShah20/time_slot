export interface BusyInterval {
  start: Date;
  end: Date;
}

/** First hour tasks may start (inclusive). Preferred window ends at 11 PM. */
const WORK_START_HOUR = 7; // 7 AM
/**
 * Hard blackout boundary. Nothing is ever scheduled between LATE_NIGHT_MAX_HOUR
 * (3 AM) and WORK_START_HOUR (7 AM). The midnight – 3 AM range is a valid last
 * resort when earlier slots are all taken (e.g. a packed day with a tight deadline).
 * Preferred scheduling window is 7 AM – 11 PM.
 */
const LATE_NIGHT_MAX_HOUR = 3; // 3 AM

// ─── Timezone-aware helpers ────────────────────────────────────────────────

/**
 * Returns the local hour (0–23 + fractional minutes) for `date` in `tz`.
 * Always uses the Intl API so it's correct on UTC servers (Vercel).
 */
export function localHourIn(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour')?.value  ?? 0) % 24;
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h + m / 60;
}

/**
 * Returns the local YYYY-MM-DD string for `date` in `tz`.
 * Uses 'sv' locale which produces ISO-format dates natively.
 */
export function localDateStrIn(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('sv', { timeZone: tz }).format(date);
}

/**
 * Constructs the UTC Date that corresponds to `hour:minute` on the same local day
 * as `date` (optionally offset by `dayOffset` local days) in `tz`.
 * Correct across DST transitions.
 */
export function localTimeOnDay(date: Date, hour: number, minute: number, tz: string, dayOffset = 0): Date {
  const [y, m, d] = localDateStrIn(date, tz).split('-').map(Number);
  // Start from a naive UTC time and correct using the actual timezone offset at that moment.
  const naive = new Date(Date.UTC(y, m - 1, d + dayOffset, hour, minute, 0));
  const naiveLocalH = localHourIn(naive, tz);
  const correction  = (naiveLocalH - (hour + minute / 60)) * 3_600_000;
  const corrected   = new Date(naive.getTime() - correction);
  // One verification pass to handle DST edge cases
  const verifyH = localHourIn(corrected, tz);
  if (Math.abs(verifyH - (hour + minute / 60)) > 0.1) {
    const correction2 = (verifyH - (hour + minute / 60)) * 3_600_000;
    return new Date(corrected.getTime() - correction2);
  }
  return corrected;
}

/**
 * Advances `t` into the valid scheduling window in `tz`.
 * • 3 AM – 7 AM (hard blackout) → snaps to 7 AM on the same local day.
 * • All other hours (7 AM – midnight, or midnight – 3 AM as a last resort) → kept as-is.
 */
function snapToWorkHours(t: Date, tz: string): Date {
  const h = localHourIn(t, tz);
  // Hard blackout (3 AM – 7 AM): snap to 7 AM same local day.
  if (h >= LATE_NIGHT_MAX_HOUR && h < WORK_START_HOUR) {
    return localTimeOnDay(t, WORK_START_HOUR, 0, tz, 0);
  }
  return t;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Deterministic free-slot finder.
 * Finds the earliest gap in `busyIntervals` that fits `estimatedMinutes`,
 * starting no earlier than now+10 min.
 *
 * Scheduling priority:
 *   1. Preferred: 7 AM – 11 PM (college student normal hours)
 *   2. Last resort: 11 PM – 3 AM (used only when earlier slots are fully booked)
 *   3. Hard blackout: 3 AM – 7 AM (never scheduled)
 *
 * Falls back to the next day's 7 AM when tonight is also fully booked.
 *
 * @param timezone  IANA timezone string (e.g. "America/New_York"). Defaults to
 *                  "America/Los_Angeles" for backwards-compat, but you should
 *                  always pass the user's real timezone so this works on UTC servers.
 */
export function fallbackSchedule(
  busyIntervals: BusyInterval[],
  estimatedMinutes: number,
  deadline?: string | null,
  timezone = 'America/Los_Angeles',
): { scheduled_start: string; scheduled_end: string } {
  const now    = new Date();
  const sorted = [...busyIntervals].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Start within valid hours, at least 10 minutes from now.
  let candidate = snapToWorkHours(new Date(now.getTime() + 10 * 60_000), timezone);

  console.log(
    `[fallbackSchedule] TZ=${timezone} | start candidate=${candidate.toISOString()} (local ${localHourIn(candidate, timezone).toFixed(1)}h)`
  );

  // Iteratively push past busy intervals, snapping back into valid hours after each push.
  let changed = true;
  let guard   = 0;
  while (changed && guard < 500) {
    guard++;
    changed = false;

    const end      = new Date(candidate.getTime() + estimatedMinutes * 60_000);
    const endH     = localHourIn(end, timezone);
    const crossDay = localDateStrIn(end, timezone) !== localDateStrIn(candidate, timezone);

    // If the slot end lands in the hard blackout (3 AM – 7 AM), push to 7 AM on
    // the end's local day. If it crosses into next-day daytime (7 AM+), do the same.
    // A slot ending between midnight and 3 AM is acceptable as a last resort and is
    // left alone to fall through to the overlap check.
    const endInBlackout     = endH >= LATE_NIGHT_MAX_HOUR && endH < WORK_START_HOUR;
    const endCrossesIntoDay = crossDay && endH >= WORK_START_HOUR;
    if (endInBlackout || endCrossesIntoDay) {
      candidate = localTimeOnDay(end, WORK_START_HOUR, 0, timezone, 0);
      changed   = true;
      continue;
    }

    // Push past any busy interval that overlaps [candidate, end)
    for (const iv of sorted) {
      if (iv.start < end && iv.end > candidate) {
        candidate = snapToWorkHours(iv.end, timezone); // re-snap after each push
        changed   = true;
        break;
      }
    }
  }

  // ── Deadline validation ────────────────────────────────────────────────────
  if (deadline) {
    const dl  = new Date(deadline);
    const end = new Date(candidate.getTime() + estimatedMinutes * 60_000);

    if (end <= dl) {
      console.log(`[fallbackSchedule] ✅ ${candidate.toISOString()} (local ${localHourIn(candidate, timezone).toFixed(1)}h)`);
      return { scheduled_start: candidate.toISOString(), scheduled_end: end.toISOString() };
    }

    // Last resort: place task right before deadline.
    // Reject only if start or end lands in the hard blackout (3 AM – 7 AM).
    const startBeforeDl   = new Date(dl.getTime() - estimatedMinutes * 60_000);
    const startH          = localHourIn(startBeforeDl, timezone);
    const dlH             = localHourIn(dl, timezone);
    const startInBlackout = startH >= LATE_NIGHT_MAX_HOUR && startH < WORK_START_HOUR;
    const endInBlackout   = dlH   >= LATE_NIGHT_MAX_HOUR && dlH   < WORK_START_HOUR;
    const hasConflict     = sorted.some((iv) => iv.start < dl && iv.end > startBeforeDl);
    if (startBeforeDl > now && !startInBlackout && !endInBlackout && !hasConflict) {
      console.log(`[fallbackSchedule] ✅ (pre-deadline) ${startBeforeDl.toISOString()} (local ${startH.toFixed(1)}h)`);
      return {
        scheduled_start: startBeforeDl.toISOString(),
        scheduled_end:   dl.toISOString(),
      };
    }
  }

  const finalEnd = new Date(candidate.getTime() + estimatedMinutes * 60_000);
  console.log(`[fallbackSchedule] ✅ ${candidate.toISOString()} (local ${localHourIn(candidate, timezone).toFixed(1)}h)`);
  return {
    scheduled_start: candidate.toISOString(),
    scheduled_end:   finalEnd.toISOString(),
  };
}
