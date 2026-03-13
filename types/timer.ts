// ─── Core state machine ───────────────────────────────────────────────────────

export type TimerState = 'IDLE' | 'WORKING' | 'PAUSED' | 'ON_BREAK';

// ─── localStorage schema ──────────────────────────────────────────────────────

export interface LocalTimerState {
  state: Exclude<TimerState, 'IDLE'>;
  taskId: string;
  taskTitle: string;
  estimatedMinutes: number;
  /** ISO string — wall-clock moment the task was first started */
  startedAt: string;
  /** ISO string — set when entering PAUSED, cleared on resume */
  pausedAt: string | null;
  /** ISO string — set when entering ON_BREAK, cleared on end break */
  currentBreakStartedAt: string | null;
  /** Accumulated break seconds from all completed breaks */
  totalBreakSeconds: number;
  /** Sessions recorded so far (open last one has no endedAt) */
  sessions: LocalSession[];
}

export interface LocalSession {
  type: 'work' | 'break';
  startedAt: string;  // ISO
  endedAt: string | null;
}

// ─── Database row mirrors ─────────────────────────────────────────────────────

export interface TaskRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  tag: 'Study' | 'Work' | 'Personal' | 'Exercise' | 'Other' | null;
  priority: 'low' | 'medium' | 'high' | null;
  estimated_minutes: number;
  actual_duration: number | null;
  deadline: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  is_fixed?: boolean;
  needs_rescheduling?: boolean;
  reminder_minutes?: number | null;
  session_number?: number;
  total_sessions?: number;
  parent_task_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskStats {
  total: number;
  upcoming: number;
  completed: number;
  avgAccuracy?: number | null;
  mostProductiveTag?: string | null;
  mostProductiveMinutes?: number | null;
}

export interface ActiveTimerRow {
  id: string;
  user_id: string;
  task_id: string;
  state: 'WORKING' | 'PAUSED' | 'ON_BREAK';
  started_at: string;
  paused_at: string | null;
  current_break_started_at: string | null;
  total_break_seconds: number;
  estimated_minutes: number;
  task_title: string;
  updated_at: string;
}

export interface TimerSessionRow {
  id: string;
  task_id: string;
  user_id: string;
  type: 'work' | 'break';
  started_at: string;
  ended_at: string | null;
  duration: number | null;
  created_at: string;
}

// ─── Stats returned on task completion ───────────────────────────────────────

export interface CompletionStats {
  taskId: string;
  taskTitle: string;
  estimatedMinutes: number;
  actualWorkSeconds: number;
  totalBreakSeconds: number;
}

// ─── Calendar blocks (manual + Google) ───────────────────────────────────────

export interface CalendarBlock {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_busy: boolean;
  source: 'manual' | 'google';
}

// ─── What React components consume ───────────────────────────────────────────

export interface TimerDisplayState {
  timerState: TimerState;
  taskTitle: string;
  taskId: string;
  estimatedMinutes: number;
  /** Derived elapsed work seconds (does not include active break) */
  workElapsedSeconds: number;
  /** Elapsed seconds in the current break (0 when not on break) */
  breakElapsedSeconds: number;
  totalBreakSeconds: number;
}
