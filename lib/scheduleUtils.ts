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

/**
 * Advances `t` into the next valid work-hours window (7 AM – 11 PM).
 * • Before 7 AM  → snaps to 7 AM same day.
 * • At or after 11 PM → snaps to 7 AM next day.
 */
function snapToWorkHours(t: Date): Date {
  const h      = t.getHours() + t.getMinutes() / 60;
  const result = new Date(t);
  if (h < WORK_START_HOUR) {
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  } else if (h >= WORK_END_HOUR) {
    result.setDate(result.getDate() + 1);
    result.setHours(WORK_START_HOUR, 0, 0, 0);
  }
  return result;
}

/**
 * Deterministic free-slot finder.
 * Finds the earliest gap in `busyIntervals` that fits `estimatedMinutes`,
 * starting no earlier than now+10 min and only within work hours (7 AM – 11 PM).
 * Never schedules in the 12 AM – 7 AM blackout window.
 * Falls back to the next work-hours window when today is full.
 */
export function fallbackSchedule(
  busyIntervals: BusyInterval[],
  estimatedMinutes: number,
  deadline?: string | null,
): { scheduled_start: string; scheduled_end: string } {
  const now    = new Date();
  const sorted = [...busyIntervals].sort((a, b) => a.start.getTime() - b.start.getTime());

  // Start within work hours, at least 10 minutes from now
  let candidate = snapToWorkHours(new Date(now.getTime() + 10 * 60_000));

  // Iteratively push past busy intervals, snapping back to work hours after each push.
  // Guard cap prevents infinite loops (~500 steps covers well over a month of daily searching).
  let changed = true;
  let guard   = 0;
  while (changed && guard < 500) {
    guard++;
    changed = false;

    const end      = new Date(candidate.getTime() + estimatedMinutes * 60_000);
    const endH     = end.getHours() + end.getMinutes() / 60;
    const crossDay = end.getDate() !== candidate.getDate() || end.getMonth() !== candidate.getMonth();

    // Slot end is past 11 PM or wraps into the next calendar day → jump to next day 7 AM
    if (endH > WORK_END_HOUR || crossDay) {
      const next = new Date(candidate);
      next.setDate(next.getDate() + 1);
      next.setHours(WORK_START_HOUR, 0, 0, 0);
      candidate = next;
      changed   = true;
      continue;
    }

    // Push past any busy interval that overlaps [candidate, end)
    for (const iv of sorted) {
      if (iv.start < end && iv.end > candidate) {
        candidate = snapToWorkHours(iv.end); // re-snap after each push — this is the core fix
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
      // Candidate slot fits before deadline ✓
      return { scheduled_start: candidate.toISOString(), scheduled_end: end.toISOString() };
    }

    // Candidate overshot the deadline (today/tonight is fully packed).
    // Last resort: place task right before deadline — allowed in 7 AM–midnight window only.
    // Never place in the 12 AM–7 AM blackout, even as a last resort.
    const startBeforeDl = new Date(dl.getTime() - estimatedMinutes * 60_000);
    const startH        = startBeforeDl.getHours() + startBeforeDl.getMinutes() / 60;
    const inBlackout    = startH < BLACKOUT_END; // 12am–7am hard stop
    const hasConflict   = sorted.some((iv) => iv.start < dl && iv.end > startBeforeDl);
    if (startBeforeDl > now && !inBlackout && !hasConflict) {
      return {
        scheduled_start: startBeforeDl.toISOString(),
        scheduled_end:   dl.toISOString(),
      };
    }
  }

  // Return the first available work-hours slot found
  const finalEnd = new Date(candidate.getTime() + estimatedMinutes * 60_000);
  return {
    scheduled_start: candidate.toISOString(),
    scheduled_end:   finalEnd.toISOString(),
  };
}
