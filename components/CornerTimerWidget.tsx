'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TimerDisplayState, CompletionStats } from '@/types/timer';
import * as timer from '@/lib/timerService';

// ─── useTimer hook ────────────────────────────────────────────────────────────

function useTimer(onComplete: (stats: CompletionStats) => void) {
  const [display, setDisplay] = useState<TimerDisplayState | null>(null);

  useEffect(() => {
    timer.restoreTimerOnLoad();
    setDisplay(timer.getDisplayState());

    const intervalId = setInterval(() => {
      setDisplay(timer.getDisplayState());
    }, 1000);

    return () => {
      clearInterval(intervalId);
      timer.stopSyncInterval();
    };
  }, []);

  const handlePause = useCallback(() => {
    timer.pauseWork();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleResume = useCallback(() => {
    timer.resumeWork();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleStartBreak = useCallback(() => {
    timer.startBreak();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleEndBreak = useCallback(() => {
    timer.endBreak();
    setDisplay(timer.getDisplayState());
  }, []);

  const handleComplete = useCallback(async () => {
    const stats = await timer.completeTask();
    setDisplay(null);
    if (stats) onComplete(stats);
  }, [onComplete]);

  return { display, handlePause, handleResume, handleStartBreak, handleEndBreak, handleComplete };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function progressPercent(workElapsed: number, estimatedMinutes: number): number {
  const total = estimatedMinutes * 60;
  return Math.min(100, Math.round((workElapsed / total) * 100));
}

function StateDot({ state }: { state: TimerDisplayState['timerState'] }) {
  const color =
    state === 'WORKING'  ? 'bg-teal-500'    :
    state === 'PAUSED'   ? 'bg-amber-400'   :
    state === 'ON_BREAK' ? 'bg-purple-500'  : 'bg-surface-400';

  return (
    <span className="relative flex h-2.5 w-2.5">
      {state === 'WORKING' && (
        <span className={`animate-pulse-ring absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${color}`} />
    </span>
  );
}

// ─── CornerTimerWidget ────────────────────────────────────────────────────────

interface Props {
  onComplete: (stats: CompletionStats) => void;
  onTimerFinish: () => void;
}

export default function CornerTimerWidget({ onComplete, onTimerFinish }: Props) {
  const handleComplete = useCallback(
    (stats: CompletionStats) => {
      onComplete(stats);
      onTimerFinish();
    },
    [onComplete, onTimerFinish]
  );

  const { display, handlePause, handleResume, handleStartBreak, handleEndBreak, handleComplete: doComplete } =
    useTimer(handleComplete);

  // Only render when a timer is active
  if (!display) return null;

  const { timerState, taskTitle, estimatedMinutes, workElapsedSeconds, breakElapsedSeconds } = display;
  const pct = progressPercent(workElapsedSeconds, estimatedMinutes);
  const overTime = workElapsedSeconds > estimatedMinutes * 60;
  const stateLabel =
    timerState === 'WORKING' ? 'Working' :
    timerState === 'PAUSED'  ? 'Paused'  : 'On Break';

  return (
    <div className="fixed bottom-6 right-6 z-40 w-72 bg-white rounded-2xl shadow-2xl border border-surface-200 p-4">
      {/* Status row */}
      <div className="flex items-center gap-2 mb-2">
        <StateDot state={timerState} />
        <span className="text-xs font-semibold text-surface-500 uppercase tracking-wide">{stateLabel}</span>
      </div>

      {/* Task title */}
      <p className="text-sm font-bold text-surface-900 truncate mb-3" title={taskTitle}>
        {taskTitle}
      </p>

      {/* Timer + progress */}
      <div className="flex items-center gap-3 mb-3">
        <span className={`text-xl font-mono font-bold tabular-nums ${overTime ? 'text-red-500' : 'text-teal-600'}`}>
          {timerState === 'ON_BREAK' ? formatTime(breakElapsedSeconds) : formatTime(workElapsedSeconds)}
        </span>
        <div className="flex-1 bg-surface-100 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-1000 ${overTime ? 'bg-red-400' : 'bg-teal-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-xs text-surface-400">{pct}%</span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-1.5">
        {timerState === 'WORKING' && (
          <>
            <button onClick={handlePause}      className="flex-1 py-1.5 text-xs font-medium border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors text-surface-700">Pause</button>
            <button onClick={handleStartBreak} className="flex-1 py-1.5 text-xs font-medium border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors">Break</button>
            <button onClick={doComplete}        className="flex-1 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">Done</button>
          </>
        )}
        {timerState === 'PAUSED' && (
          <>
            <button onClick={handleResume}     className="flex-1 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors">Resume</button>
            <button onClick={handleStartBreak} className="flex-1 py-1.5 text-xs font-medium border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors">Break</button>
            <button onClick={doComplete}        className="flex-1 py-1.5 text-xs font-medium border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors">Done</button>
          </>
        )}
        {timerState === 'ON_BREAK' && (
          <button onClick={handleEndBreak} className="flex-1 py-1.5 text-xs font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors">End Break</button>
        )}
      </div>
    </div>
  );
}
