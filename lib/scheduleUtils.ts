export interface BusyInterval {
  start: Date;
  end: Date;
}

/** First hour tasks may start (inclusive). */
const WORK_START_HOUR = 7;  // 7 AM
/** Last hour tasks may end (exclusive — slots must finish by 11 PM). */
const WORK_END_HOUR   = 23; // 11 PM
/** Hard blackout: never start a task between midnight and 7 AM. */
const BLACKOUT_END    = 7;  // 12 AM – 7 AM

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
 * Advances `t` into the next valid work-hours window (7 AM – 11 PM) in `tz`.
 * • Before 7 AM  → snaps to 7 AM same local day.
 * • At or after 11 PM → snaps to 7 AM next local day.
 */
function snapToWorkHours(t: Date, tz: string): Date {
  const h = localHourIn(t, tz);
  if (h >= WORK_START_HOUR && h < WORK_END_HOUR) return t;
  if (h < WORK_START_HOUR) return localTimeOnDay(t, WORK_START_HOUR, 0, tz, 0);
  return localTimeOnDay(t, WORK_START_HOUR, 0, tz, 1); // past 11 PM → next day
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Deterministic free-slot finder.
 * Finds the earliest gap in `busyIntervals` that fits `estimatedMinutes`,
 * starting no earlier than now+10 min and only within work hours (7 AM – 11 PM local).
 * Never schedules in the 12 AM – 7 AM blackout window.
 * Falls back to the next work-hours window when today is full.
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

  // Start within work hours, at least 10 minutes from now
  let candidate = snapToWorkHours(new Date(now.getTime() + 10 * 60_000), timezone);

  console.log(
    `[fallbackSchedule] TZ=${timezone} | start candidate=${candidate.toISOString()} (local ${localHourIn(candidate, timezone).toFixed(1)}h)`
  );

  // Iteratively push past busy intervals, snapping back to work hours after each push.
  let changed = true;
  let guard   = 0;
  while (changed && guard < 500) {
    guard++;
    changed = false;

    const end     = new Date(candidate.getTime() + estimatedMinutes * 60_000);
    const endH    = localHourIn(end, timezone);
    const crossDay = localDateStrIn(end, timezone) !== localDateStrIn(candidate, timezone);

    // Slot end is past 11 PM local or wraps into the next local day → next day 7 AM
    if (endH > WORK_END_HOUR || crossDay) {
      candidate = localTimeOnDay(candidate, WORK_START_HOUR, 0, timezone, 1);
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

    // Last resort: place task right before deadline — never in the 12 AM–7 AM blackout.
    const startBeforeDl = new Date(dl.getTime() - estimatedMinutes * 60_000);
    const startH        = localHourIn(startBeforeDl, timezone);
    const inBlackout    = startH < BLACKOUT_END;
    const hasConflict   = sorted.some((iv) => iv.start < dl && iv.end > startBeforeDl);
    if (startBeforeDl > now && !inBlackout && !hasConflict) {
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
