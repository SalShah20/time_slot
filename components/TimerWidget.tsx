'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TimerDisplayState, CompletionStats } from '@/types/timer';
import * as timer from '@/lib/timerService';

// ─── useTimer hook ─────────────────────────────────────────────────────────────

function useTimer(onComplete: (stats: CompletionStats) => void) {
  const [display, setDisplay] = useState<TimerDisplayState | null>(null);

  // Restore on mount
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

// ─── State dot ────────────────────────────────────────────────────────────────

function StateDot({ state }: { state: TimerDisplayState['timerState'] }) {
  const color =
    state === 'WORKING'
      ? 'bg-teal-500'
      : state === 'PAUSED'
      ? 'bg-amber-400'
      : state === 'ON_BREAK'
      ? 'bg-purple-500'
      : 'bg-surface-400';

  return (
    <span className="relative flex h-3 w-3">
      {state === 'WORKING' && (
        <span className={`animate-pulse-ring absolute inline-flex h-full w-full rounded-full ${color} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${color}`} />
    </span>
  );
}

// ─── TimerWidget ──────────────────────────────────────────────────────────────

interface Props {
  onComplete: (stats: CompletionStats) => void;
}

export default function TimerWidget({ onComplete }: Props) {
  const { display, handlePause, handleResume, handleStartBreak, handleEndBreak, handleComplete } =
    useTimer(onComplete);

  if (!display) return null;

  const { timerState, taskTitle, estimatedMinutes, workElapsedSeconds, breakElapsedSeconds, totalBreakSeconds } =
    display;

  const pct = progressPercent(workElapsedSeconds, estimatedMinutes);
  const overTime = workElapsedSeconds > estimatedMinutes * 60;

  const stateLabel =
    timerState === 'WORKING'
      ? 'Working'
      : timerState === 'PAUSED'
      ? 'Paused'
      : timerState === 'ON_BREAK'
      ? 'On Break'
      : '';

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-surface-200 p-6 w-full max-w-md mx-auto">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <StateDot state={timerState} />
        <span className="text-sm font-medium text-surface-500">{stateLabel}</span>
      </div>

      {/* Task title */}
      <h3 className="text-xl font-bold text-surface-900 mb-5 truncate" title={taskTitle}>
        {taskTitle}
      </h3>

      {/* Main timer */}
      <div className={`text-5xl font-mono font-bold mb-1 tabular-nums ${overTime ? 'text-red-500' : 'text-teal-600'}`}>
        {timerState === 'ON_BREAK' ? formatTime(breakElapsedSeconds) : formatTime(workElapsedSeconds)}
      </div>
      <div className="text-sm text-surface-500 mb-5">
        {timerState === 'ON_BREAK'
          ? 'Break time'
          : `of ${estimatedMinutes} min estimated`}
      </div>

      {/* Progress bar */}
      {timerState !== 'ON_BREAK' && (
        <div className="w-full bg-surface-100 rounded-full h-2 mb-5">
          <div
            className={`h-2 rounded-full transition-all duration-1000 ${overTime ? 'bg-red-400' : 'bg-teal-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Break stat */}
      {totalBreakSeconds > 0 && timerState !== 'ON_BREAK' && (
        <p className="text-xs text-surface-400 mb-4">
          Total break: {formatTime(totalBreakSeconds)}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {timerState === 'WORKING' && (
          <>
            <button
              onClick={handlePause}
              className="flex-1 px-3 py-2 text-sm font-medium border border-surface-300 rounded-lg hover:bg-surface-50 transition-colors text-surface-700"
            >
              Pause
            </button>
            <button
              onClick={handleStartBreak}
              className="flex-1 px-3 py-2 text-sm font-medium border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors"
            >
              Take Break
            </button>
            <button
              onClick={handleComplete}
              className="flex-1 px-3 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              Complete
            </button>
          </>
        )}

        {timerState === 'PAUSED' && (
          <>
            <button
              onClick={handleResume}
              className="flex-1 px-3 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors"
            >
              Resume
            </button>
            <button
              onClick={handleStartBreak}
              className="flex-1 px-3 py-2 text-sm font-medium border border-purple-300 text-purple-700 rounded-lg hover:bg-purple-50 transition-colors"
            >
              Take Break
            </button>
            <button
              onClick={handleComplete}
              className="flex-1 px-3 py-2 text-sm font-medium border border-surface-300 text-surface-700 rounded-lg hover:bg-surface-50 transition-colors"
            >
              Complete
            </button>
          </>
        )}

        {timerState === 'ON_BREAK' && (
          <button
            onClick={handleEndBreak}
            className="flex-1 px-3 py-2 text-sm font-medium bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            End Break
          </button>
        )}
      </div>
    </div>
  );
}
