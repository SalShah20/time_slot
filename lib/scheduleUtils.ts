export interface BusyInterval {
  start: Date;
  end: Date;
}

/**
 * Deterministic free-slot finder.
 * Finds the earliest gap in `busyIntervals` that fits `estimatedMinutes`,
 * starting no earlier than now+10 min and no later than 9pm today.
 * Falls back to 8am tomorrow if no slot exists today.
 */
export function fallbackSchedule(
  busyIntervals: BusyInterval[],
  estimatedMinutes: number,
  deadline?: string | null,
): { scheduled_start: string; scheduled_end: string } {
  const now        = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0, 0);
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 21, 0, 0);

  const sorted = [...busyIntervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const nowPlus10 = new Date(now.getTime() + 10 * 60_000);
  let candidate = nowPlus10 > todayStart ? nowPlus10 : todayStart;

  // Push candidate past any overlapping busy interval
  let changed = true;
  while (changed) {
    changed = false;
    for (const iv of sorted) {
      const end = new Date(candidate.getTime() + estimatedMinutes * 60_000);
      if (iv.start < end && iv.end > candidate) {
        candidate = iv.end;
        changed = true;
      }
    }
  }

  // Respect deadline
  if (deadline) {
    const dl  = new Date(deadline);
    const end = new Date(candidate.getTime() + estimatedMinutes * 60_000);
    if (end <= dl) {
      return { scheduled_start: candidate.toISOString(), scheduled_end: end.toISOString() };
    }
    const startBeforeDl = new Date(dl.getTime() - estimatedMinutes * 60_000);
    if (startBeforeDl > now) {
      return { scheduled_start: startBeforeDl.toISOString(), scheduled_end: dl.toISOString() };
    }
  }

  // Fall back to tomorrow 8am if no slot today before 9pm
  const cutoff = new Date(todayEnd.getTime() - estimatedMinutes * 60_000);
  if (candidate > cutoff) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    candidate = tomorrow;
  }

  return {
    scheduled_start: candidate.toISOString(),
    scheduled_end: new Date(candidate.getTime() + estimatedMinutes * 60_000).toISOString(),
  };
}
