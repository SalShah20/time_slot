export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface WorkHours {
  workStartHour: number;   // default 8  (earliest start)
  workEndHour: number;     // default 23 (end of preferred window)
  workEndLateHour: number; // default 3  (absolute latest / last resort)
  preferMornings?: boolean;
  preferEvenings?: boolean;
  avoidBackToBack?: boolean;
}

export const DEFAULT_WORK_HOURS: WorkHours = {
  workStartHour: 8,
  workEndHour: 23,
  workEndLateHour: 3,
};

/** First hour tasks may start (inclusive). Preferred window ends at 11 PM. */
export const WORK_START_HOUR = 8; // 8 AM
/**
 * Hard blackout boundary. Nothing is ever scheduled between LATE_NIGHT_MAX_HOUR
 * (3 AM) and WORK_START_HOUR (8 AM). The midnight – 3 AM range is a valid last
 * resort when earlier slots are all taken (e.g. a packed day with a tight deadline).
 * Preferred scheduling window is 8 AM – 11 PM.
 */
export const LATE_NIGHT_MAX_HOUR = 3; // 3 AM

/** Split a decimal hour (e.g. 8.5) into [hour, minute] (e.g. [8, 30]). */
export function splitDecimalHour(h: number): [number, number] {
  const hour = Math.floor(h);
  const minute = Math.round((h - hour) * 60);
  return [hour, minute];
}

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
  // For timezones behind UTC (UTC-N), naiveLocalH > 12 because midnight UTC falls on the
  // *previous* local day (e.g. UTC-5 sees 19h). Subtracting 24 gives the real offset
  // (-5) so the correction adds hours forward rather than subtracting them backward.
  const naiveLocalHNorm = naiveLocalH > 12 ? naiveLocalH - 24 : naiveLocalH;
  const correction  = (naiveLocalHNorm - (hour + minute / 60)) * 3_600_000;
  const corrected   = new Date(naive.getTime() - correction);
  // One verification pass to handle DST edge cases
  const verifyH = localHourIn(corrected, tz);
  if (Math.abs(verifyH - (hour + minute / 60)) > 0.1) {
    const verifyHNorm = verifyH > 12 ? verifyH - 24 : verifyH;
    const correction2 = (verifyHNorm - (hour + minute / 60)) * 3_600_000;
    return new Date(corrected.getTime() - correction2);
  }
  return corrected;
}

/**
 * Advances `t` into the valid scheduling window in `tz`.
 * Hard blackout (lateHour – startHour) → snaps to startHour on the same local day.
 */
function snapToWorkHours(t: Date, tz: string, wh: WorkHours = DEFAULT_WORK_HOURS): Date {
  const h = localHourIn(t, tz);
  if (h >= wh.workEndLateHour && h < wh.workStartHour) {
    const [sh, sm] = splitDecimalHour(wh.workStartHour);
    return localTimeOnDay(t, sh, sm, tz, 0);
  }
  return t;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Deterministic free-slot finder.
 * Finds the earliest gap in `busyIntervals` that fits `estimatedMinutes`,
 * starting no earlier than now+60 min.
 *
 * Scheduling priority:
 *   1. Preferred: workStartHour – workEndHour
 *   2. Last resort: workEndHour – workEndLateHour (next day)
 *   3. Hard blackout: workEndLateHour – workStartHour (never scheduled)
 *
 * Falls back to the next day's workStartHour when tonight is also fully booked.
 */
export function fallbackSchedule(
  busyIntervals: BusyInterval[],
  estimatedMinutes: number,
  deadline?: string | null,
  timezone = 'America/Los_Angeles',
  workHours: WorkHours = DEFAULT_WORK_HOURS,
): { scheduled_start: string; scheduled_end: string } {
  const now    = new Date();
  const wh     = workHours;
  // Pad each busy interval's end to guarantee breathing room between tasks.
  // avoidBackToBack = true → 25 min gap (15 min extra); default → 10 min gap.
  const padMinutes = wh.avoidBackToBack ? 25 : 10;
  const sorted = busyIntervals
    .map((iv) => ({ start: iv.start, end: new Date(iv.end.getTime() + padMinutes * 60_000) }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // If deadline is more than 5 days away, start from tomorrow at workStartHour instead
  // of ASAP — there's no urgency to schedule it immediately.
  const DAYS_UNTIL_DEFER = 5;
  const fiveDaysFromNow = new Date(now.getTime() + DAYS_UNTIL_DEFER * 24 * 60 * 60_000);
  const useDeferredStart = deadline && new Date(deadline) > fiveDaysFromNow;

  const [wsH, wsM] = splitDecimalHour(wh.workStartHour);
  let candidate: Date;
  if (useDeferredStart) {
    candidate = localTimeOnDay(now, wsH, wsM, timezone, 1);
  } else {
    candidate = snapToWorkHours(new Date(now.getTime() + 60 * 60_000), timezone, wh);
  }

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

    const endInBlackout     = endH >= wh.workEndLateHour && endH < wh.workStartHour;
    const endCrossesIntoDay = crossDay && endH >= wh.workStartHour;
    if (endInBlackout || endCrossesIntoDay) {
      candidate = localTimeOnDay(end, wsH, wsM, timezone, 0);
      changed   = true;
      continue;
    }

    // Push past any busy interval that overlaps [candidate, end)
    // (iv.end already includes the 10-min padding applied above)
    for (const iv of sorted) {
      if (iv.start < end && iv.end > candidate) {
        candidate = snapToWorkHours(new Date(iv.end.getTime()), timezone, wh);
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
    const startBeforeDl   = new Date(dl.getTime() - estimatedMinutes * 60_000);
    const startH          = localHourIn(startBeforeDl, timezone);
    const dlH             = localHourIn(dl, timezone);
    const startInBlackout = startH >= wh.workEndLateHour && startH < wh.workStartHour;
    const endInBlackout2  = dlH   >= wh.workEndLateHour && dlH   < wh.workStartHour;
    const hasConflict     = sorted.some((iv) => iv.start < dl && iv.end > startBeforeDl);
    if (startBeforeDl > now && !startInBlackout && !endInBlackout2 && !hasConflict) {
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

// ─── Free block enumeration ─────────────────────────────────────────────────

export interface FreeBlock {
  start: Date;
  end: Date;
  /** Duration in fractional minutes */
  durationMinutes: number;
}

/**
 * Returns all schedulable free blocks >= minMinutes within [from, to].
 * Respects the scheduling window: strips the blackout from every gap.
 * A gap that spans the blackout is split into sub-blocks.
 */
export function findFreeBlocksInWindow(
  busyIntervals: BusyInterval[],
  from: Date,
  to: Date,
  minMinutes: number,
  timezone: string,
  workHours: WorkHours = DEFAULT_WORK_HOURS,
): FreeBlock[] {
  if (from >= to) return [];
  const wh = workHours;

  // Clip busy intervals to [from, to] and sort
  const clipped = busyIntervals
    .filter((iv) => iv.end > from && iv.start < to)
    .map((iv) => ({
      start: iv.start < from ? from : iv.start,
      end:   iv.end   > to   ? to   : iv.end,
    }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlapping busy intervals
  const merged: Array<{ start: Date; end: Date }> = [];
  for (const iv of clipped) {
    if (merged.length > 0 && iv.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = new Date(
        Math.max(merged[merged.length - 1].end.getTime(), iv.end.getTime()),
      );
    } else {
      merged.push({ start: new Date(iv.start), end: new Date(iv.end) });
    }
  }

  // Find raw free gaps within [from, to]
  const gaps: Array<{ start: Date; end: Date }> = [];
  let cursor = from;
  for (const iv of merged) {
    if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start });
    if (iv.end > cursor) cursor = iv.end;
  }
  if (cursor < to) gaps.push({ start: cursor, end: to });

  // For each gap, extract valid sub-blocks respecting the blackout
  const freeBlocks: FreeBlock[] = [];
  const [startH, startM] = splitDecimalHour(wh.workStartHour);
  const [lateH, lateM]   = splitDecimalHour(wh.workEndLateHour);

  for (const gap of gaps) {
    let subCursor = gap.start;
    let guard = 0;

    while (subCursor < gap.end && guard < 200) {
      guard++;
      const h = localHourIn(subCursor, timezone);

      // Snap out of blackout
      if (h >= wh.workEndLateHour && h < wh.workStartHour) {
        subCursor = localTimeOnDay(subCursor, startH, startM, timezone, 0);
        continue;
      }

      // Determine end of current valid window (next late-hour boundary)
      const validWindowEnd: Date =
        h < wh.workEndLateHour
          ? localTimeOnDay(subCursor, lateH, lateM, timezone, 0)
          : localTimeOnDay(subCursor, lateH, lateM, timezone, 1);

      const blockEnd = new Date(Math.min(validWindowEnd.getTime(), gap.end.getTime()));
      const durationMinutes = (blockEnd.getTime() - subCursor.getTime()) / 60_000;

      if (durationMinutes >= minMinutes) {
        freeBlocks.push({ start: new Date(subCursor), end: new Date(blockEnd), durationMinutes });
      }

      // Advance past the blackout to next workStartHour
      subCursor = localTimeOnDay(validWindowEnd, startH, startM, timezone, 0);
    }
  }

  return freeBlocks.sort((a, b) => a.start.getTime() - b.start.getTime());
}

// ─── Title-based scheduling hints ─────────────────────────────────────────

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

/**
 * If the title mentions a specific day of the week (e.g. "on Tuesday", "next Monday"),
 * returns the next occurrence of that day as a Date at midnight local time.
 * "on Tuesday" when today is Tuesday returns NEXT Tuesday (7 days out).
 */
export function detectTargetDay(title: string, timezone: string): Date | null {
  const lower = title.toLowerCase();
  const match = DAYS.find((d) =>
    lower.includes(`on ${d}`) ||
    lower.includes(`by ${d}`) ||
    lower.includes(`next ${d}`) ||
    lower.includes(`this ${d}`),
  );
  if (!match) return null;

  const target = DAYS.indexOf(match);
  const now = new Date();
  const localDayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long' })
    .format(now)
    .toLowerCase();
  const currentIdx = DAYS.indexOf(localDayName as typeof DAYS[number]);
  if (currentIdx === -1) return null;

  let daysUntil = target - currentIdx;
  if (daysUntil <= 0) daysUntil += 7;

  return localTimeOnDay(now, 0, 0, timezone, daysUntil);
}

const TIME_REGEX = /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

/**
 * If the title contains an explicit time like "at 4pm" or "at 14:30",
 * returns { hour, minute } in 24-hour format. Returns null otherwise.
 */
export function detectPinnedTime(title: string): { hour: number; minute: number } | null {
  const m = title.match(TIME_REGEX);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = parseInt(m[2] ?? '0', 10);
  const period = m[3]?.toLowerCase();

  if (period === 'pm' && hour < 12) hour += 12;
  if (period === 'am' && hour === 12) hour = 0;
  // No am/pm specified: assume PM for hours 1-7 (e.g. "at 4" = 4 PM)
  if (!period && hour >= 1 && hour <= 7) hour += 12;

  return { hour, minute };
}
