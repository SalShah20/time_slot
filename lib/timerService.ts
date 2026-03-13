/**
 * timerService — client-side state machine singleton.
 *
 * Key invariants:
 *  - Elapsed work time is always derived from timestamps, never a counter.
 *  - One sync interval per session; cleaned up by useTimer() hook on unmount.
 *  - localStorage is written before every API call so a network error never
 *    leaves localStorage and DB out of sync (localStorage is authoritative).
 */

import type {
  LocalTimerState,
  LocalSession,
  CompletionStats,
  TimerDisplayState,
  TimerState,
} from '@/types/timer';

const LS_KEY = 'timeslot_timer';
const SYNC_INTERVAL_MS = 30_000;
const STALE_BREAK_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function secondsBetween(a: string, b: string = now()): number {
  return Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 1000));
}

function loadLocal(): LocalTimerState | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LocalTimerState) : null;
  } catch {
    return null;
  }
}

function saveLocal(state: LocalTimerState): void {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

function clearLocal(): void {
  localStorage.removeItem(LS_KEY);
}

// ─── Elapsed-time computation ─────────────────────────────────────────────────

export function computeWorkElapsed(s: LocalTimerState, atTime: string = now()): number {
  const totalWallClock = secondsBetween(s.startedAt, atTime);

  // Seconds currently accumulated in an in-progress pause (not yet resume)
  const pausedInProgress =
    s.state === 'PAUSED' && s.pausedAt ? secondsBetween(s.pausedAt, atTime) : 0;

  // Seconds in the current break (work timer is frozen during breaks)
  const breakInProgress =
    s.state === 'ON_BREAK' && s.currentBreakStartedAt
      ? secondsBetween(s.currentBreakStartedAt, atTime)
      : 0;

  return Math.max(
    0,
    totalWallClock - s.totalBreakSeconds - breakInProgress - pausedInProgress
  );
}

export function computeBreakElapsed(s: LocalTimerState, atTime: string = now()): number {
  if (s.state !== 'ON_BREAK' || !s.currentBreakStartedAt) return 0;
  return secondsBetween(s.currentBreakStartedAt, atTime);
}

// ─── API helpers (fire-and-forget-safe) ──────────────────────────────────────

async function apiPost(path: string, body: Record<string, unknown>): Promise<void> {
  try {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn(`[timerService] ${path} failed (will retry on next sync)`, err);
  }
}

// ─── Sync interval ───────────────────────────────────────────────────────────

let syncIntervalId: ReturnType<typeof setInterval> | null = null;

function startSyncInterval(): void {
  if (syncIntervalId) return;
  syncIntervalId = setInterval(() => {
    void syncToServer();
  }, SYNC_INTERVAL_MS);
}

export function stopSyncInterval(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
}

async function syncToServer(): Promise<void> {
  const s = loadLocal();
  if (!s) return;

  await apiPost('/api/timer/sync', {
    state: s.state,
    taskId: s.taskId,
    startedAt: s.startedAt,
    pausedAt: s.pausedAt,
    currentBreakStartedAt: s.currentBreakStartedAt,
    totalBreakSeconds: s.totalBreakSeconds,
    estimatedMinutes: s.estimatedMinutes,
    taskTitle: s.taskTitle,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Call this in useEffect on mount. Restores the sync interval and handles
 * stale-break auto-end (>2 h break is ended automatically).
 */
export function restoreTimerOnLoad(): void {
  const s = loadLocal();
  if (!s) return;

  // Auto-end a stale break
  if (s.state === 'ON_BREAK' && s.currentBreakStartedAt) {
    const breakMs =
      new Date().getTime() - new Date(s.currentBreakStartedAt).getTime();
    if (breakMs > STALE_BREAK_THRESHOLD_MS) {
      const breakDuration = Math.floor(breakMs / 1000);
      const endedBreakSession: LocalSession = {
        type: 'break',
        startedAt: s.currentBreakStartedAt,
        endedAt: now(),
      };
      const updated: LocalTimerState = {
        ...s,
        state: 'WORKING',
        currentBreakStartedAt: null,
        totalBreakSeconds: s.totalBreakSeconds + breakDuration,
        sessions: [...s.sessions, endedBreakSession],
      };
      saveLocal(updated);
    }
  }

  startSyncInterval();
}

/** IDLE → WORKING */
export async function startTask(
  taskId: string,
  taskTitle: string,
  estimatedMinutes: number
): Promise<void> {
  const startedAt = now();

  const initialState: LocalTimerState = {
    state: 'WORKING',
    taskId,
    taskTitle,
    estimatedMinutes,
    startedAt,
    pausedAt: null,
    currentBreakStartedAt: null,
    totalBreakSeconds: 0,
    sessions: [{ type: 'work', startedAt, endedAt: null }],
  };

  saveLocal(initialState);

  await apiPost('/api/timer/start', { taskId, startedAt, estimatedMinutes, taskTitle });

  startSyncInterval();
}

/** WORKING → PAUSED */
export function pauseWork(): void {
  const s = loadLocal();
  if (!s || s.state !== 'WORKING') return;

  const pausedAt = now();
  saveLocal({ ...s, state: 'PAUSED', pausedAt });

  // Fire-and-forget; next sync corrects if it fails
  void apiPost('/api/timer/pause', { pausedAt });
}

/** PAUSED → WORKING */
export function resumeWork(): void {
  const s = loadLocal();
  if (!s || s.state !== 'PAUSED') return;

  saveLocal({ ...s, state: 'WORKING', pausedAt: null });
  // No API call needed; next sync will persist the resumed state
}

/** WORKING | PAUSED → ON_BREAK */
export function startBreak(): void {
  const s = loadLocal();
  if (!s || (s.state !== 'WORKING' && s.state !== 'PAUSED')) return;

  // Option A simplification: if paused, clear pausedAt before starting break
  // so time doesn't double-count.
  const currentBreakStartedAt = now();
  const breakSession: LocalSession = { type: 'break', startedAt: currentBreakStartedAt, endedAt: null };

  saveLocal({
    ...s,
    state: 'ON_BREAK',
    pausedAt: null,
    currentBreakStartedAt,
    sessions: [...s.sessions, breakSession],
  });
}

/** ON_BREAK → WORKING */
export function endBreak(): void {
  const s = loadLocal();
  if (!s || s.state !== 'ON_BREAK' || !s.currentBreakStartedAt) return;

  const endedAt = now();
  const breakDuration = secondsBetween(s.currentBreakStartedAt, endedAt);

  // Close the open break session and open a new work session
  const closedSessions = s.sessions.map((sess) =>
    sess.type === 'break' && sess.endedAt === null ? { ...sess, endedAt } : sess
  );
  const newWorkSession: LocalSession = { type: 'work', startedAt: endedAt, endedAt: null };

  const updated: LocalTimerState = {
    ...s,
    state: 'WORKING',
    currentBreakStartedAt: null,
    totalBreakSeconds: s.totalBreakSeconds + breakDuration,
    sessions: [...closedSessions, newWorkSession],
  };

  saveLocal(updated);
  void syncToServer();
}

/** Switch to a new task: complete current → start new */
export async function switchTask(
  newTaskId: string,
  newTaskTitle: string,
  newEstimatedMinutes: number
): Promise<CompletionStats | null> {
  const stats = await completeTask();
  await startTask(newTaskId, newTaskTitle, newEstimatedMinutes);
  return stats;
}

/** any → IDLE — returns CompletionStats for the popup */
export async function completeTask(): Promise<CompletionStats | null> {
  const s = loadLocal();
  if (!s) return null;

  const completedAt = now();

  // Close any open session
  const closedSessions = s.sessions.map((sess) =>
    sess.endedAt === null ? { ...sess, endedAt: completedAt } : sess
  );

  const actualWorkSeconds = computeWorkElapsed(s, completedAt);
  const totalBreakSeconds =
    s.state === 'ON_BREAK' && s.currentBreakStartedAt
      ? s.totalBreakSeconds + secondsBetween(s.currentBreakStartedAt, completedAt)
      : s.totalBreakSeconds;

  const stats: CompletionStats = {
    taskId: s.taskId,
    taskTitle: s.taskTitle,
    estimatedMinutes: s.estimatedMinutes,
    actualWorkSeconds,
    totalBreakSeconds,
  };

  stopSyncInterval();
  clearLocal();

  await apiPost('/api/timer/complete', {
    taskId: s.taskId,
    actualWorkSeconds,
    totalBreakSeconds,
    sessions: closedSessions,
  });

  return stats;
}

/** Returns a snapshot of current display values (call every second from useTimer) */
export function getDisplayState(): TimerDisplayState | null {
  const s = loadLocal();
  if (!s) return null;

  const t = now();
  return {
    timerState: s.state as TimerState,
    taskTitle: s.taskTitle,
    taskId: s.taskId,
    estimatedMinutes: s.estimatedMinutes,
    workElapsedSeconds: computeWorkElapsed(s, t),
    breakElapsedSeconds: computeBreakElapsed(s, t),
    totalBreakSeconds: s.totalBreakSeconds,
  };
}

/** True if there is an active timer in localStorage */
export function hasActiveTimer(): boolean {
  return loadLocal() !== null;
}
